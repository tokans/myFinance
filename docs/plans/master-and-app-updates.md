# Plan: Decoupled master-data updates + executable self-update

Status: **DRAFT — awaiting approval.** No code until signed off.

## Goal

Ship master/reference data independently of the executable, updated over-the-air
from GitHub Releases (`tokans/myFinance`), securely and without restart. Separately,
let the executable self-update with user consent. A daily background pass checks both.

## Data & telemetry philosophy

myFinance is **receive-only**: no backend exists, so the app cannot and does not send any
user data anywhere. Local usage telemetry (app-launch log, migration 0018) stays on-device
and is used only to **unlock features locally** — never transmitted. The network calls this
plan introduces are strictly *inbound* (pulling signed reference data); they upload nothing.
Any future third-party integration is opt-in, mostly receive-only, and sends only the
minimum required for that feature, with explicit user consent. No analytics, no phone-home.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| A | Signing-key location | **Offline** (private key never touches CI/cloud) |
| B | PII distribution model | **Broadcast** (same file to all installs) |
| C | At-rest encryption key | **Per-install random key in OS keystore** |
| D | Executable self-update | **Official Tauri Updater plugin** |
| E | Update cadence / UX | Daily, background thread, non-blocking. Data = silent hot-apply, no restart. App = toast w/ "what's new"→README, user-consented install+restart. |

## Security model (final)

Threats addressed: tampering/forgery (authenticity), eavesdropping + disk theft
(confidentiality), downgrade/replay.

**Honest caveat (decision B):** a broadcast file cannot be cryptographically hidden
from the users who run the exe — the transport key must ship in the binary. So
transport encryption is **obfuscation** against third parties (network/MITM). The
**real** confidentiality win is **at rest**: each cached master is re-encrypted with a
per-install key from the OS keystore, so a stolen laptop / backup / other OS user
cannot read the PII.

### Crypto construction (encrypt-then-sign, verify-before-decrypt)

Publisher (offline):
```
plaintext master JSON
  → AES-256-GCM (TRANSPORT key, per-file random 12-byte nonce)  → <id>.master.enc  [nonce || ct || tag]
manifest { revision, sha256(<id>.master.enc), … }
  → Ed25519 detached signature (OFFLINE private key)            → masters.manifest.json.sig
```

Client (Rust, in order — never decrypt unverified bytes):
```
1. fetch manifest + .sig
2. verify Ed25519 sig against ONE OF two baked public keys      → reject on fail
3. reject if revision <= last-trusted (downgrade protection)
4. reject if minAppVersion > current app version (compat)
5. per changed entry: stream-download, verify sha256(ct)        → reject on mismatch
6. AES-256-GCM decrypt with baked TRANSPORT key                 → plaintext
7. zod-validate plaintext (known fields, clamps, size caps)     → reject on fail
8. AES-256-GCM RE-ENCRYPT with per-install OS-keystore key
9. transactional upsert into SQLite; bump last-trusted revision
```

Keys:
- **Ed25519 signing**: offline private key (owner's machine). Bake **two** public keys
  (primary + rollover) in `src-tauri/src/masters_update.rs` so the key can be rotated
  without an emergency rebuild.
- **AES-256 transport**: 32-byte key baked in the binary (obfuscation-grade by design).
- **AES-256 at-rest**: 32-byte random key generated on first run, stored via the
  `keyring` crate (Win Credential Manager / macOS Keychain / Linux secret-service).
- App-updater signing key: **separate** Ed25519 keypair, also offline (Tauri's own format).

Why both AES + Ed25519: GCM integrity is symmetric (forgeable by anyone with the
transport key); the Ed25519 signature is what proves *we* published it.

---

## Artifacts published to `tokans/myFinance` releases

Per master release (data track), uploaded to a stable, predictable tag (e.g. `masters-latest`):
- `masters.manifest.json` — plaintext metadata (below)
- `masters.manifest.json.sig` — base64 Ed25519 detached signature
- `<id>.master.enc` — AES-256-GCM ciphertext per master

App track (Tauri updater) — attached to the normal `vX.Y.Z` release by tauri-action:
- platform installers (already built by `release.yml`)
- `latest.json` + per-artifact `.sig` (Tauri updater signatures)

### Manifest schema (`src/masters/updateSchema.ts`, shared by packer + loader)
```ts
{
  revision: number,          // monotonic; client rejects <= last-trusted
  generatedAt: string,       // ISO; informational
  schemaVersion: number,     // master data shape version
  minAppVersion: string,     // semver; client skips if its version is lower
  entries: Array<{
    id: MasterId,
    file: string,            // "<id>.master.enc"
    bytes: number,
    sha256: string,          // hex sha256 of the CIPHERTEXT
    version: number          // per-master revision
  }>
}
```

---

## Implementation phases

### Phase 1 — Manifest + encrypted packer (offline tooling)
- `src/masters/updateSchema.ts` — zod schema for manifest + per-master payload.
- `scripts/pack-masters.ts` — reads `src/masters/data/*.json`, AES-256-GCM encrypts each
  with the transport key, writes `dist-masters/<id>.master.enc` + `masters.manifest.json`.
- `scripts/sign-masters.ts` — Ed25519-sign the manifest with the offline private key
  (or use `minisign`); emit `masters.manifest.json.sig`. Run **on the owner's machine**.

### Phase 2 — Keys
- Generate Ed25519 signing keypair (offline) + AES-256 transport key + app-updater keypair.
- Bake public signing keys (×2) + transport key into `src-tauri/src/masters_update.rs`.
- Document key custody in `docs/keys.md` (private keys NOT committed; stored in owner's
  password manager / offline).

### Phase 3 — CI publish (`.github/workflows/release.yml`)
- Add a job/step that uploads the **pre-signed** `dist-masters/*` to the `masters-latest`
  release on tokans/myFinance (offline model → CI only uploads, never signs).
- Configure tauri-action to emit + attach updater `latest.json` and `.sig` for Track B.

### Phase 4 — DB: master_options table
- New migration `00NN_master_options.sql`: `(master_id, value, label, icon, parent, source,
  version, PRIMARY KEY(master_id, value, parent))`, `source ∈ {remote}`.
- TS wrapper `src/db/masterOptions.ts`: `upsertMany` (transactional), `listFor`, `clearStale`.
- Loader precedence becomes: **remote (DB) → baked JSON → custom_options**, all zod-validated,
  drop to baked on any failure. Update `src/masters/registry.ts` / `store.ts`.

### Phase 5 — Rust: at-rest key management
- Add `keyring` crate. `get_or_create_install_key()` → 32-byte key in OS keystore.

### Phase 6 — Rust: data-track sync (`masters_update.rs`)
- Crates: `ed25519-dalek`, `aes-gcm`, `sha2`, `reqwest` (streaming).
- Tauri command `sync_masters() -> SyncReport` implementing the 9-step client flow above;
  streaming download; transactional upsert; persist `state.json` (revision + hashes) in appDataDir.
- Add the `masters-latest` asset URL host to `src-tauri/capabilities/default.json` allowlist.
- Emit a Tauri event `masters-updated` on success.

### Phase 7 — Frontend: background scheduler + live reload
- `src/masters/updates.ts` — on app mount, spawn the daily check (throttled once/24h via
  persisted `lastCheckedAt`, jittered, fail-silent). Calls `sync_masters`.
- On `masters-updated` event → invalidate TanStack Query master caches → UI refreshes live,
  no restart.

### Phase 8 — Track B: executable self-update
- Add `@tauri-apps/plugin-updater` + `tauri-plugin-updater`; register in `lib.rs`; capability grant.
- Updater endpoint = the tokans/myFinance `latest.json`.
- Same daily pass calls `check()`. If newer: show a **toast** ("Update available · What's new")
  where "What's new" opens the README on tokans/myFinance.
- On accept → `downloadAndInstall()` → relaunch. DB migrations run on next boot via the
  existing `Vec<Migration>` system (no new mechanism).
- On decline → dismiss; re-offer next day.

### Phase 9 — Settings + UX
- Settings store: `updates: { dataEnabled, appEnabled, lastCheckedAt, lastDataRevision }`.
- Settings UI: two toggles + status lines ("Reference data updated <date>", "Version 0.1.0").

### Phase 10 — Sink hardening (defense even against a signed-but-evil file)
- Audit consumers of master values (FIRE calc, currency, labels, custom_options).
- Numeric clamps (e.g. cost index ∈ [1,1000]), string-length caps; confirm no SQL string-
  concat (parameterized only), no raw-HTML render, no URL-building from master values.

### Phase 11 — Tests (extend `src/masters/store.test.ts` + new Rust tests)
- Signature pass/fail, downgrade rejection, sha256 mismatch, GCM tamper (bad tag),
  decrypt failure → baked fallback, malformed-but-signed → reject, compat-version skip,
  offline → baked, live reload on event.

### Phase 12 — Docs / memory
- Update `CLAUDE.md` masters section + add a memory documenting the update mechanism and
  key custody.

## Constraint check
- Client-only / no backend ✅ (GitHub Releases = static host).
- Webview CSP untouched ✅ (all crypto + network on Rust side).
- Offline-first ✅ (baked JSON remains the floor).
- No LLM ✅. Single configurable currency / FY ✅ (unaffected).
- New: one daily outbound network touch — mitigated by per-track opt-out toggles, jitter,
  no identifiers, fail-silent.

## Implementation notes — deviations from the original plan

Two decisions made during implementation (Phases 5–7), with rationale:

1. **Verification runs in TypeScript, not Rust.** The plan put crypto in Rust for
   "baked-key tamper resistance." But for a locally-installed app, an attacker who can
   swap the Rust binary can equally swap the JS bundle — so baked-in-Rust vs JS-constant
   buys little against *local* tampering, which is game-over regardless. The signature's
   real job is securing the *OTA channel* (MITM, malicious release asset), which JS
   verification covers identically. In exchange we get code that is **unit-tested here**
   (`verify.test.ts`, 9 cases incl. tamper/downgrade/hash-mismatch), cross-platform
   (`@noble/ed25519`, no WebKit Ed25519 dependency), and reuses the existing
   `tauri-plugin-http` path. Moving verification into Rust later remains an option if
   defense-in-depth is wanted.

2. **At-rest storage matches the rest of the app (plain SQLite), not per-table encryption.**
   `myfinance.db` is not encrypted today — `people`, `documents`, account contacts already
   store PII in plaintext; only the Stronghold vault is encrypted. Encrypting *only* OTA
   partner data at rest, while everything else stays plaintext, would be inconsistent and
   give a false sense of security. So the per-install OS-keystore re-encryption (old
   decision C) is **deferred**; OTA data lands in SQLite like all other app data. Transport
   encryption + signature still protect the OTA channel. True at-rest protection, if wanted,
   should be **DB-wide** (e.g. SQLCipher) as a separate initiative — tracked, not done here.

## Open / smaller decisions (non-blocking, defaults chosen)
- Update toggles default **ON** with a one-line disclosure.
- Stable data pointer = a dedicated `masters-latest` release tag (vs parsing newest `vX`).
- Hard manifest expiry: **skipped** (monotonic revision used instead).
