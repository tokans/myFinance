//! L2 shared-core bootstrap — the "first app installs the core, the second reuses
//! it" mechanism from sharedCoreLib/CONTRACT.md, implemented app-side (the Rust
//! transport/bootstrap is intentionally NOT in the shared npm package — see the
//! contract). Portable across all installers because it runs in `lib.rs` setup.
//!
//! Two layers of "core":
//!   * L1 — the build-time TS/React library (`sharedcorelib`) — is bundled into
//!     this app's webview bundle; it is never runtime-shared.
//!   * L2 — heavy, downloaded runtime assets (the OTA masters cache, and any
//!     native sidecars/models) — IS shared, once, in a per-user suite dir.
//!
//! This module manages L2: a per-user (no-admin) shared dir with a refcounted
//! `manifest.json { core_version, owners[] }`. Lay-down-or-reuse on startup,
//! standalone fallback if the shared dir is unusable, and a deregister hook for
//! uninstall. NEVER touches user data (vault/DB/settings stay strictly per-app).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// L2 layout version this app bundles. Bump when the shared L2 directory layout
/// changes in a backward-compatible way (a newer app upgrades it in place). A
/// breaking change would move to a versioned subdir (`core/v2`) so majors coexist.
pub const CORE_VERSION: u32 = 1;

/// This app's stable id in the shared `owners[]` refcount. Must be unique per app.
pub const APP_ID: &str = "myFinance";

/// Suite root folder name under the per-user local-data dir, shared across the suite.
///
/// Debug builds (`tauri:dev`) use a SEPARATE root so development data never bleeds into
/// an installed production app's shared suite DB — and so a freshly installed MSI starts
/// from an empty `suite.db` instead of inheriting whatever the dev build left behind.
/// Every suite app must apply the same rule, so dev apps still share L2 with each other
/// and prod apps with each other — just never across the dev/prod boundary.
#[cfg(debug_assertions)]
const SUITE_DIR: &str = "SharedCoreLib-dev";
#[cfg(not(debug_assertions))]
const SUITE_DIR: &str = "SharedCoreLib";

#[derive(Serialize, Deserialize, Default)]
struct CoreManifest {
    #[serde(default)]
    core_version: u32,
    #[serde(default)]
    owners: Vec<String>,
}

/// The shared suite core dir: `<local_data_dir>/SharedCoreLib/core`.
/// `local_data_dir()` resolves to `%LOCALAPPDATA%` (Windows),
/// `~/Library/Application Support` (macOS), `~/.local/share` (Linux) — exactly the
/// per-user, no-admin roots the contract specifies.
fn shared_core_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .local_data_dir()
        .ok()
        .map(|d| d.join(SUITE_DIR).join("core"))
}

fn read_manifest(dir: &Path) -> CoreManifest {
    fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_manifest(dir: &Path, m: &CoreManifest) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(m).unwrap_or_default();
    fs::write(dir.join("manifest.json"), json)
}

/// Lay down or reuse L2, register this app as an owner, and return the **masters
/// OTA cache dir** to inject into the JS updater. Standalone-safe: on any failure
/// (missing/unwritable shared dir) it falls back to this app's own data dir, so an
/// app installed alone always works.
pub fn ensure_shared_core<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    if let Some(dir) = shared_core_dir(app) {
        if try_ensure(&dir).is_ok() {
            return dir.join("masters");
        }
    }
    // Fallback: app-private masters cache (independent of the suite).
    let fallback = app
        .path()
        .app_data_dir()
        .map(|d| d.join("masters"))
        .unwrap_or_else(|_| PathBuf::from("masters"));
    let _ = fs::create_dir_all(&fallback);
    fallback
}

fn try_ensure(dir: &Path) -> std::io::Result<()> {
    let mut m = read_manifest(dir);

    // Lay-down-or-reuse + in-place upgrade within the same major: if the shared
    // copy is older than what we bundle, bump it; if it's newer-or-equal, reuse.
    if m.core_version < CORE_VERSION {
        m.core_version = CORE_VERSION;
    }

    // L2 sub-layout (downloaded/native assets shared across the suite).
    fs::create_dir_all(dir.join("masters"))?; // OTA reference-data cache
    fs::create_dir_all(dir.join("db"))?; // shared suite database (per-app + common tables)
    fs::create_dir_all(dir.join("bin"))?; // shared native sidecars (if any)
    fs::create_dir_all(dir.join("models"))?; // shared ML models (if any)

    // Refcount: register this app (idempotent).
    if !m.owners.iter().any(|o| o == APP_ID) {
        m.owners.push(APP_ID.to_string());
    }

    write_manifest(dir, &m)
}

/// Uninstall hook: drop this app from `owners[]`; delete the shared dir ONLY when
/// the last owner leaves, so removing one app never breaks another. Wire this into
/// the installer's uninstall step (platform-specific) — hence not called at
/// runtime. Best-effort.
#[allow(dead_code)]
pub fn deregister_shared_core<R: Runtime>(app: &AppHandle<R>) {
    if let Some(dir) = shared_core_dir(app) {
        let mut m = read_manifest(&dir);
        m.owners.retain(|o| o != APP_ID);
        if m.owners.is_empty() {
            let _ = fs::remove_dir_all(&dir);
        } else {
            let _ = write_manifest(&dir, &m);
        }
    }
}

/// Expose the (ensured) shared masters cache dir to the webview so the JS OTA
/// updater can inject it as its `cacheDir`. The FIRST suite app to pull downloads
/// into this dir; the SECOND reuses the cache. Idempotent.
#[tauri::command]
pub fn shared_core_masters_dir(app: AppHandle) -> String {
    ensure_shared_core(&app).to_string_lossy().to_string()
}

/// The shared suite DATABASE file: `<shared core>/db/suite.db` — the ONE SQLite the
/// suite shares (per-app + common tables, governed by the schema registry; see
/// sharedcorelib/db). Standalone-safe: falls back to this app's own data dir if the
/// shared dir is unusable, so an app installed alone still works. Idempotent.
pub fn shared_core_db_file<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    if let Some(dir) = shared_core_dir(app) {
        if try_ensure(&dir).is_ok() {
            return dir.join("db").join("suite.db");
        }
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("suite.db"))
        .unwrap_or_else(|_| PathBuf::from("suite.db"))
}

/// Webview-facing path to the shared suite DB, loaded via the SQL plugin as
/// `Database.load("sqlite:" + path)`. Idempotent (ensures the shared dir first).
#[tauri::command]
pub fn shared_core_db_path(app: AppHandle) -> String {
    shared_core_db_file(&app).to_string_lossy().to_string()
}

// ── Legacy per-app DB consolidation (K1, decisions 6/24) ─────────────────────
//
// Before consolidation the app stored everything in a per-app SQLite the Tauri SQL
// plugin opened as `sqlite:myfinance.db` (resolved under the app config dir). The
// one-time migrator (src/db/consolidate.ts) copies it into the shared suite.db and
// then asks the Rust side to DELETE the file. These two commands are the only
// privileged file ops involved; the migration itself is pure TS over both DBs.

/// The legacy per-app DB file name (what the SQL plugin opened by relative path).
const LEGACY_DB_FILE: &str = "myfinance.db";

/// Absolute path of the legacy DB, in the app config dir the SQL plugin resolved
/// `sqlite:myfinance.db` against. `None` if the config dir can't be resolved.
fn legacy_db_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join(LEGACY_DB_FILE))
}

/// Whether the legacy `myfinance.db` file still exists (drives the one-time migration).
#[tauri::command]
pub fn legacy_db_exists(app: AppHandle) -> bool {
    legacy_db_path(&app).map(|p| p.exists()).unwrap_or(false)
}

/// Delete the legacy `myfinance.db` (+ its WAL/SHM sidecars) after a verified
/// migration. Returns true when a file was actually removed. Pre-authorized
/// (decisions 6/24, pre-customer) — the migrator only calls this once the suite DB
/// holds a verified copy and the ledger marks the migration done.
#[tauri::command]
pub fn legacy_db_remove(app: AppHandle) -> Result<bool, String> {
    let Some(path) = legacy_db_path(&app) else {
        return Ok(false);
    };
    let mut removed = false;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove {LEGACY_DB_FILE}: {e}"))?;
        removed = true;
    }
    // Best-effort: drop the WAL/SHM sidecars so no stale journal lingers.
    for ext in ["-wal", "-shm"] {
        let side = path.with_file_name(format!("{LEGACY_DB_FILE}{ext}"));
        if side.exists() {
            let _ = fs::remove_file(&side);
        }
    }
    Ok(removed)
}
