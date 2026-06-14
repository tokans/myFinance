use argon2::{Argon2, Algorithm, Params, Version};

mod core_bootstrap;
mod sync;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // K1 consolidation (decisions 1/2/4): the per-app Tauri-plugin migration array is
    // RETIRED. There is no `myfinance.db` to migrate going forward — every table lives
    // in the shared `suite.db`, created on launch by `registerSchemas` +
    // `registerAuxMigrations` (sharedcorelib/db) from the TS descriptors + aux-SQL
    // (src/db/schemas.ts, auxSql.ts). The SQL plugin is still registered (below, with
    // NO migrations) so the webview can open suite.db — and the legacy `myfinance.db`
    // for the one-time migrator — by absolute path. The legacy file is detected/deleted
    // via the `legacy_db_exists` / `legacy_db_remove` commands (src/db/consolidate.ts).
    // The old `src-tauri/migrations/*.sql` files are kept in the tree only as the
    // historical reference the descriptors + aux-SQL were derived from.

    // Salt is constant per-app — fine because the master password is the secret.
    // Stronghold's snapshot encryption uses this derived key, and the snapshot file
    // is stored in the app data dir under each user's OS profile.
    const SALT: &[u8] = b"myFinance-stronghold-v1-salt";

    tauri::Builder::default()
        .manage(sync::SyncState::default())
        .invoke_handler(tauri::generate_handler![
            sync::sync_host_start,
            sync::sync_host_received,
            sync::sync_stop,
            sync::sync_discover,
            sync::sync_join,
            core_bootstrap::shared_core_masters_dir,
            core_bootstrap::shared_core_db_path,
            core_bootstrap::legacy_db_exists,
            core_bootstrap::legacy_db_remove,
        ])
        .setup(|_app| {
            // L2 shared-core bootstrap: lay down or reuse the per-user suite dir
            // and register this app as an owner (idempotent). Standalone-safe — on
            // any failure it falls back to this app's own data dir. The returned
            // masters cache path is also reachable from JS via the
            // `shared_core_masters_dir` command (injected into the OTA updater).
            let _ = core_bootstrap::ensure_shared_core(_app.handle());

            // Demo-capture mode: launch with `--demo` to maximize the window so it
            // uses the whole available screen. The recorder captures the client
            // area and normalizes every GIF to a fixed, black-padded canvas, so
            // framing stays identical regardless of this machine's resolution/DPI.
            // No effect on a normal launch — the flag is only passed by the demo
            // rig / manual `tauri dev -- --demo` runs.
            // Gated to debug + desktop only: this whole block is compiled OUT of
            // release builds (`tauri build`) and mobile builds, so the shipped
            // binary contains no demo code. The rig uses a debug binary.
            #[cfg(all(desktop, debug_assertions))]
            if std::env::args().any(|a| a == "--demo") {
                use tauri::Manager;
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.maximize();
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                let params = Params::new(15_000, 2, 1, Some(32))
                    .expect("argon2 params");
                let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
                let mut key = [0u8; 32];
                argon
                    .hash_password_into(password.as_bytes(), SALT, &mut key)
                    .expect("argon2 hash");
                key.to_vec()
            })
            .build(),
        )
        .plugin(
            // No migrations: the shared suite DB owns its schema (TS descriptors +
            // aux-SQL). The plugin is here only so the webview can open databases by
            // path (suite.db, and the legacy myfinance.db during the one-time migration).
            tauri_plugin_sql::Builder::default().build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
