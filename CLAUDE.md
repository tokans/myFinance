# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Vite only on http://localhost:1420 — browser preview, NO database/vault.
npm run tauri:dev     # Full app (Rust shell + webview). Required for anything touching SQLite or Stronghold.
npm run build         # Type-check (tsc --noEmit) + production Vite bundle into dist/.
npm run tauri:build   # Build native installers (output under src-tauri/target/release/bundle/).
build.bat             # Double-clickable Windows-only wrapper around tauri:build; installs deps if missing.

deploy.bat / npm run deploy   # GUIDED release. Boots a Claude Code agent into the /deploy-release gate,
                              # which verifies every publish gate (docs/release-checklist.md), walks you
                              # through the next remaining step, and only tags + pushes (firing release.yml)
                              # once ALL blocking gates pass. deploy-direct.bat is the ungated escape hatch.

npm run tauri:android:init / :dev   # Requires Android SDK + NDK + JDK 17 (already configured on dev machine).
npm run tauri:ios:init    / :dev    # Mac+Xcode only.

npm run test          # Vitest (unit/domain) — *.test.ts colocated with source. The de-facto correctness gate.
npm run test:watch    # Vitest watch mode.
npm run test:e2e      # Playwright e2e (browser-mode flows). :e2e:ui for the runner UI.

# Demo capture (dev-only marketing GIFs — drives the REAL app via WebDriver, never shipped):
npm run demo:single -- 01-basic-import   # record one scenario (add --build to rebuild first)
npm run demo:all                          # record all scenarios under demo/scenarios/
npm run demo:gifs                         # re-encode existing MP4s → GIF without re-recording
npm run demo:reset / demo:build           # wipe app data / force a demo-mode rebuild

# Signed reference-data + patron tooling (run offline; keys never committed):
npm run masters:keys / masters:pack / masters:sign   # OTA master/partner bundle pipeline
npm run patron:keys  / patron:make                   # patron-unlock file pipeline
```

Tests run under **Vitest** (`npm run test`) — unit/domain `*.test.ts` files sit next to their source (e.g. `src/domain/calc.test.ts`). Playwright covers browser-mode e2e. There is no linter wired into npm scripts. `scripts/test-*.ts` are ad-hoc tsx-runnable harnesses for Excel/ITR parsers — run individually with `npx tsx scripts/<name>.ts`. Type errors are an additional gate; `npm run build` (tsc --noEmit) will fail on any.

## High-level architecture

Two-process Tauri v2 app: a React/TS webview frontend talking to a thin Rust shell that exposes SQLite, FS, dialogs, and Stronghold via plugins. **No backend, no web target** — data lives entirely on the user's device.

### Shared core (`sharedcorelib`)

App-agnostic infrastructure has been extracted into a standalone, dependency-injected package **`sharedcorelib`** at `C:\workspace\sharedCoreLib`, consumed via `"sharedcorelib": "file:../sharedCoreLib"` (mirrors the `@mydemo/core` precedent — `file:../` + injected config, no module-level singletons). It compiles to `dist/`; a `prebuild` script builds it before myFinance's `tsc`/Vite. **myFinance keeps its own data, domain, pages, migrations, registries, branding, and per-app secrets**; the core only provides reusable mechanisms parameterized by config. The full subpath-export list + app-config contract is in `C:\workspace\sharedCoreLib\CONTRACT.md`. Extracted so far: `/env`, `/crypto` (was `lib/packageCrypto`), `/vault` (Stronghold + DEK + doc blobs), `/masters` (OTA verify/merge/`createOtaUpdater`), `/tiers`, `/gating` (`createGatingStore`), `/reminders` (+ notify + sweep), `/report` (HTML→PDF), `/ice`, `/sync` (the LWW kernel only), `/ui` (`cn`, attribution, `AppHarness`, **`SuiteShell`** + **`Sheet`**, the Tailwind **preset** + **`theme.css`**). Several myFinance modules (`lib/environment`, `lib/packageCrypto`, `vault/*`, `masters/verify|store|updates`, `lib/gamification`, `stores/gating.store`, `domain/reminders`, `lib/notify|reminderSweep|fireReport|emergency|utils`, `sync/merge`) are now thin re-export shims or config call-sites over the core. **Intentionally left in-app:** the Argon2 vault salt/params (per-app, in `lib.rs` — never change), the schema-bound sync merge engine + Rust transport, launch telemetry (DB-bound), `FeatureGuard`/gate defs, and the shadcn primitives + `FiniteSetInput` (the only remaining UI step). **The app shell IS now migrated to the shared `SuiteShell`** (`components/layout/AppShell.tsx` is a thin adapter feeding it nav data + central Menu actions + the Patron/Report/Emergency/More-Apps actions). Theming follows the **§4.2** policy: `tailwind.config.cjs` uses `sharedcorelib/tailwind-preset` + adds `../sharedCoreLib/src/ui/**/*.{ts,tsx}` to its `content` globs, and `src/index.css` imports `sharedcorelib/ui/theme.css` then overrides only myFinance's blue brand tokens (`--primary`/`--ring`). The **L2 install/reuse/refcount/version** mechanism (first suite app lays the shared core down, second reuses it) is `src-tauri/src/core_bootstrap.rs` (CONTRACT.md §5). See `~/.claude/projects/c--workspace-myFinance/memory/project_shared_core_extracted.md`.

### Tauri shell (`src-tauri/`)
- `src/lib.rs` is the entire Rust app. It registers the Tauri plugins (sql, stronghold, dialog, fs, os, **http**, **notification**, **opener**). `src-tauri/src/sync.rs` adds the device-to-device LAN sync transport (a dumb byte pipe — see the Device sync section).
- **Schema is owned by the suite DB, not the Rust shell (post-K1 consolidation).** The per-app Tauri-plugin migration array is **retired** — `lib.rs` registers `tauri_plugin_sql` with **no migrations**; the plugin is kept only so the webview can open databases by absolute path. Every table is now a `SchemaDescriptor` (`src/db/legacySchemas.ts` + `schemas.ts`) registered into the shared `suite.db` on launch via `registerSchemas`, and everything descriptors can't express — INTEGER AUTOINCREMENT keys, CHECKs, DEFAULTs, FK cascades, composite UNIQUEs, and the 0021/0022 sync-trigger suite — is carried by app-scoped **aux-SQL** steps (`src/db/auxSql.ts`) via `registerAuxMigrations`. To evolve the schema: add a descriptor field (append-only) and/or a NEW aux-SQL version (never edit a shipped one). The old `src-tauri/migrations/*.sql` files stay in-tree **only as the historical reference** the descriptors + aux-SQL were derived from (not run). `core_bootstrap::legacy_db_exists` / `legacy_db_remove` support the one-time legacy-DB migration (see Data layer).
- Stronghold's snapshot key is derived from the user's master password with Argon2id (15k iters, 2 lanes, 32-byte key, constant per-app salt). Do **not** change the salt or params without a vault-migration story — existing users' vaults would be unreadable.
- `capabilities/default.json` is the permission allowlist. Any new Tauri API call (FS path scope, new plugin command) must be granted here, otherwise it fails at runtime even though it type-checks.

### Frontend (`src/`)
- Entry: `main.tsx` → `App.tsx`. Routing is `HashRouter` (chosen because Tauri loads from `file://`; BrowserRouter breaks on refresh).
- Path alias `@/` → `src/` (configured in both `tsconfig.json` and `vite.config.ts`).
- State: Zustand stores in `src/stores/` — `settings.store.ts`, `vault.store.ts` (both hydrate from disk on mount), plus `tier.store.ts` (engagement tier + patron state) and `gating.store.ts` (per-feature unlock signals). See the Gamification & feature-gating section.
- Data fetching: TanStack Query is installed; pages mostly call the `src/db/*.ts` functions directly inside queries.
- UI: Tailwind + shadcn/ui-style primitives under `src/components/ui/`. The desktop sidebar + mobile three-button bottom bar (Dashboard · central **Menu** sheet · **More** drawer) come from the shared **`SuiteShell`** (`sharedcorelib/ui`); `components/layout/AppShell.tsx` is a thin adapter that supplies nav data, the central Menu actions, and the More-drawer actions (More Apps/`suite`, the 4-state Patron CTA, Report, Emergency) + mounts the Donate/Report/Emergency dialogs. Theming = shared Tailwind preset + `theme.css` with a blue brand override (§4.2).

### Data layer (`src/db/`)
- **One database (post-K1 consolidation): the shared `suite.db`.** There is no per-app `myfinance.db` anymore — `client.ts` opens the shared suite DB via the `shared_core_db_path` Tauri command, and every table is namespaced `myfinance_*` (the single source of truth for physical names is `src/db/tables.ts`'s `T` map, re-exported from `client.ts`). The `db/*.ts` wrappers address `T.*`. **`getDb()` throws if not running inside Tauri** — pages must be Tauri-only or gate with `isTauri()` from `@/lib/environment.ts`.
- **Schema = descriptors + aux-SQL** (`legacySchemas.ts` + `schemas.ts` + `auxSql.ts`), registered on launch by `initSharedDb()` (`db/sharedDb.ts`). The TS wrappers are typed accessors, not the source of truth for shape.
- **One-time legacy migration** (`db/consolidate.ts`): on first boot, if a legacy `myfinance.db` file exists and the `myfinance#MigrationLedger` says not-migrated, it copies every table into the namespaced suite tables (preserving integer rowids/keys), verifies row counts + a content checksum, writes ledger rows, then deletes the legacy file (idempotent, resumable, crash-safe). The legacy single-row `health_profile` is mapped into the shared common ICE card (invariant 6) rather than copied.
- **Health/ICE**: `db/health.ts` is now a thin adapter over the shared common ICE card (`common#IceCard`, person_key `"self"`) via `sharedDb.iceStore()` — there is no `health_profile` table; the medical card is shared suite-wide.
- Months are stored as `'YYYY-MM'` strings (regex-validated by `assertMonth`). Sort/diff math uses string comparison or the helpers in `domain/calc.ts`.
- `myfinance_monthly_snapshot` is unique on `(account_id, month)` — writes always go through `upsertSnapshot`.

### Domain logic (`src/domain/`)
Pure functions, no DB, no React. `calc.ts` does month math and `computeDashboard()` (MoM / FY-start / custom-anchor deltas). `goals.ts` does ETA projection. Keep new pure logic here — pages and components stay thin.

### Excel pipeline (`src/excel/`)
- `parse.ts` — `readWorkbook` (SheetJS) and `parseMonthFromSheetName` (handles a wide variety of formats; falls back to user's `dateFormat` setting for ambiguous DDMMYY/MMDDYY).
- `formulas.ts` — inspects in-sheet SUM/AVERAGE/SUMPRODUCT ranges to deduce the data region of non-default sheets. Cross-sheet refs are intentionally ignored.
- `import.ts` — two-phase: `previewImport` (no writes, matches rows to accounts by normalized name) then `commitImport` (auto-creates unmatched accounts when `createMissingAccounts !== false`; `zeroFillMissing` writes a 0 balance for active accounts absent from an uploaded month). The pipeline has grown well past "item/value": value columns carry a **`ValueKind`** — `balance` (cell is the balance), `credit`/`debit` (cell is a delta, balance = prev month ± cell, for cash-flow workbooks), plus `credit_card` (column becomes a separate liability account). It also reads optional **maturity-date**, **emergency-action**, and **contact** columns (see `types.ts` `ExtractedRow`/`SheetPlan`) to prefill FD maturities and the emergency/estate fields. Account type is inferred per row.
- `export.ts` / `template.ts` — write back in the default schema (one sheet per month, col A = item, col B = value). Uses native Tauri save dialog on desktop, falls back to browser download.

The "default schema = skip wizard" auto-detection is the load-bearing UX decision; the wizard is the fallback path, not the default. See `~/.claude/projects/c--workspace-myFinance/memory/project_excel_format.md`.

### Vault (`src/vault/stronghold.ts` + `src/stores/vault.store.ts`)
- Single module-level `session` variable holds the unlocked Stronghold handle. `unlock()` is idempotent; `lock()` saves+unloads.
- **Every put/remove calls `save()` inline** — there is no transactional batching, but it guarantees no lost credentials on crash. Don't refactor this away without a replacement durability guarantee.
- Vault snapshot file: `<appDataDir>/vault.stronghold`. Its existence is what `hasMasterPassword` checks against.
- UI is gated by `components/vault/UnlockPanel.tsx`; account detail uses `CredentialPanel.tsx`.

### Tax module (`src/tax/`, `src/db/tax.ts`, migration 0002)
- `itrParser.ts` ingests official ITR JSON exports (AY 2026-27 schemas under `src/tax/schemas/`). It traverses defensively — every field optional — and tracks unmapped paths so users see what wasn't captured.
- `recommendItr.ts` is a deterministic decision tree (ITR-1/2/3/4). Explicitly advisory; the UI surfaces a disclaimer. Don't add LLM-based recommendation.
- Records keyed by assessment year string (`'AY2026-27'`).

### Estate / family-readiness suite (`/estate/*`, migrations 0008–0017)
The app's largest module: help a user prepare so family can locate assets and act if the user is incapacitated or dies. `pages/Estate.tsx` is a hub linking ~11 sub-pages — Health (ICE medical card, 0011), Insurance (coverage-gap analysis, 0012), Nominees/Holdings (nominees, co-holders, beneficiaries + holding modes, 0013), Will (`will_meta`, 0014), Incapacity (PoA/AMD, `incapacity_meta`, 0015), Liquidity (survivor-operable assets + emergency fund), Access (progressive-access tiers + audit, 0016), Review (annual + life-event checklists, `life_events` 0017), FamilyPack (plain-text per-person briefing), RegisterExport (JSON or passphrase-encrypted register), and People (`people` + `documents`, 0009 — the central contact hub for nominees, executors, attorneys, claims contacts).
- **People is the shared backbone**: one `people` row is referenced as nominee/co-holder/beneficiary (`holdings.role`), executor (`will_meta`), PoA attorney (`incapacity_meta`), insurance claims contact, and emergency contact. `people.access_tier` (0/1/2) drives progressive disclosure in exports.
- **Domain logic is pure** in `src/domain/` (`will.ts` reconciles nominees vs. Will beneficiaries, `insurance.ts` does deterministic coverage-gap math, `liquidity.ts` sums survivor-operable accounts, `review.ts` builds life-event checklists, `nominations.ts`, `ice.ts`, `access.ts`, `familyPack.ts`, `registerSnapshot.ts`). No LLM — all checklists/templates/gap math are deterministic.
- **No backend "dead-man's switch"**: the staleness trigger in `domain/access.ts` is a local check (no check-in for ≥90 days); Tier-2 register export is honesty-based / requires on-device unlock.

### Documents & document crypto (`src/vault/docCrypto.ts`, `documentFiles.ts`, migration 0009)
Encrypted document blobs (PDFs, scans) are stored as UUID-named files under `<appDataDir>/documents/`, sealed with **AES-256-GCM** using a random per-device **document encryption key (DEK)** held in Stronghold (`doc-master-key-v1`), *not* the master password directly. Metadata stays in the `documents` SQLite table. Because the DEK is per-device, a sealed blob is not portable — relevant to sync (the bundle carries the decrypted blob inside its transport envelope and the receiver re-seals). Passphrase-sealed *exports* (RegisterExport / FamilyPack) use PBKDF2→AES-GCM in `src/lib/packageCrypto.ts` so a recipient can open them without the vault.

### Reminders (`src/domain/reminders.ts`, `src/db/reminders.ts`, migration 0010)
Two kinds: **`manual`** (user-created) and **`derived`** (auto-generated from domain data via a stable `dedupe_key` — FD maturities, document expiries, insurance renewals). `runReminderSweep()` (`src/lib/reminderSweep.ts`, called on idle from `App.tsx`) re-syncs derived reminders, buckets them (overdue / due-soon ≤14d / upcoming / snoozed), and raises **one** OS notification per sweep via `tauri-plugin-notification` (`src/lib/notify.ts`, graceful no-op in browser / without permission). Derived reminders are regenerated locally and **not** synced; user snooze/dismiss state on them is preserved across re-sync.

### Emergencies / ICE (`src/pages/Emergencies.tsx`, `src/domain/ice.ts`, `src/lib/emergency.ts`, migration 0008)
Two distinct surfaces: per-account emergency prep (free-text `contact` + `emergency_action` columns on `accounts`, surfaced as click-to-call/email via deterministic regex extraction in `emergency.ts`) and the ICE medical card built from `health_profile`. Keyword matching only (no LLM); a universal `EMERGENCY_DISCLAIMER` is always shown. The **`EmergencyOverlay` also reads/edits the shared common emergency card** (`common#IceCard`, person_key `"self"`) via `sharedcorelib/ice` `createIceStore` over the shared `suite.db` (`db/sharedDb.ts` → `iceStore()`); the same card is populated by sibling apps (e.g. myHealth's medical ICE card), so a personal emergency contact stays in sync across the suite without duplication. Registered in `db/schemas.ts` (kept in sync with `schema.manifest.json`); whichever suite app launches first creates the table.

### FIRE calculator (`/fire`, `src/domain/fire.ts` + `fireSim.ts` + `fireForm.ts`)
A deterministic, multi-step retirement/FIRE planner: computes the FIRE corpus (inflation-adjusted retirement spend ÷ SWR, depletion-modeled to life expectancy), time-to-FIRE, required savings, Lean/Coast/Fat classification, a 3-scenario sensitivity table, and a year-by-year simulation that models marriage/child income events and dependant lifecycles. Cost-of-living uses a **baked** city index (`src/lib/cityCost.ts`) + cross-currency PPP (`src/lib/countryCurrency.ts`) via `src/domain/locationCost.ts` — no API, no LLM. `src/lib/fireReport.ts` exports a self-contained HTML→PDF report. Gated behind a retirement goal (`feature="fire"`).

### Reference data: masters, OTA updates & partners (`src/masters/`, migrations 0007/0019/0020)
Extends the FiniteSetInput convention (see the finite-set memory). Masters registered in `registry.ts`: **country, city, currency, institution, life_goal, relationship, professional_type**. Each `FiniteSetInput` merges four layers in priority order: **remote (OTA) ⊕ baked JSON ⊕ live API ⊕ user-custom**.
- **`custom_options`** (0007) = user-typed "Other" values (custom wins, never deleted). **`master_options`** (0019) = OTA-pushed reference rows (remote wins, version-tracked). **`partners`** (0020) = a curated professional directory (doctors/lawyers/CAs) keyed by `professional_type`.
- **OTA mechanism** (`src/masters/updates.ts`, `verify.ts`): once-a-day idle check pulls a signed+encrypted bundle from a rolling **GitHub Releases** tag, verifies an **Ed25519** signature + per-file SHA-256 + monotonic revision (anti-downgrade), decrypts (AES-GCM transport key), zod-validates, then hot-applies to `master_options`/`partners` and fires a `masters:updated` event so open pickers refresh. **Receive-only**: pulls public data, uploads nothing. Signing/transport keys are placeholders until `npm run masters:keys`; the bundle pipeline is `masters:pack`/`masters:sign` (run offline). `src/db/partners.sample.ts` `seedSamplePartners()` is **TEST-ONLY** and flagged for removal before release.

### Gamification, feature-gating & patron (`src/lib/gamification.ts`, `featureGate.ts`, `patron.ts`)
Engagement tiers (`gamification.ts`): **newcomer → regular** (≥7 distinct launch days or ≥3 months of data) **→ expert** (≥20 launch days AND every core feature used once), with **patron** and **partner** as grant-only tiers that outrank expert. `resolveTier()` returns the highest qualified; `hasExpertAccess()` tests the *expert bar specifically* (so device-sync gating doesn't auto-include a patron who hasn't earned expert).
- **Feature gates** (`featureGate.ts` + `components/layout/FeatureGuard.tsx`): keys `tax` (needs an account), `fire` (needs a retirement goal), `emergency` (needs an emergency action), `sync` (needs expert). `gating.store.ts` tracks the prerequisites; locked routes render a `LockedFeature` CTA. All gates pass in browser/dev mode so previews aren't permanently locked.
- **Multi-user activation (K4, paid-gated, additive)** (`lib/multiuser.ts` + `stores/member.store.ts`): the SuiteShell `userSwitch` affordance mounts only when the paid entitlement is active (Patron/Partner) **and** the person spine has > 1 member — a free single-primary-user passes `undefined` so the shell is pixel-identical (invariant 3). Members are sourced from the shared `person` spine via core `member_class` (`membersFromPeople`). `FeatureGuard` consults the core `(member_class, feature)` **child-soft** policy (`createChildSoftPolicy`) FIRST: the sensitive **finance / estate / credentials** set (decision 19) is tagged via `FEATURE_CATEGORIES` with the core `SENSITIVE_FEATURE_CATEGORIES` vocab and hidden from `child_user` / `managed_dependent`; any adult (co-admin) and owner see everything. UI-soft only — the crypto-hard boundary is the sync private compartment (below). Member *management* itself lives in myLifeAssistant; this app only switches between existing members. Tests: `lib/multiuser.test.ts` (incl. the free-tier-unchanged invariant-3 guard).
- **Patron/Partner grants** (`patron.ts`, `patronFile.ts`): receive-only and offline, built on the shared **grant handoff** (`sharedcorelib/grant`). The user donates / enrolls on an external page, receives a **signed+encrypted grant file** they drop into Downloads (`myfinance-patron.tokans` or `myfinance-partner.tokans`), and on next launch `scanForGrants()` verifies (Ed25519 sig over AES-GCM payload), routes on the payload's `kind` field, and records `patron_since`/`partner_since` in `settings`. Single channel (dropped file only — there is no token-claim channel). No server callback; keys are placeholders until `npm run patron:keys`/`patron:make` (`patron:make --kind partner` for a Partner grant). Usage telemetry (`app_launches`, migration 0018, `src/db/usage.ts`) is local-only and never transmitted — it only unlocks tiers on-device.
- **`DEMO_MODE`** (`src/lib/demoMode.ts`, gated on `VITE_DEMO_MODE=1`): auto-unlocks the vault and redirects save dialogs to a fixed dir so demo capture runs unattended. Constant-folds away in production builds.

### Device-to-device sync (`/sync`, `src/sync/`, `src-tauri/src/sync.rs`, migration 0021)
Two-way, last-writer-wins sync over the same Wi-Fi LAN, no backend. All crypto/merge is in TypeScript; Rust is a dumb encrypted-byte pipe (tiny_http + mDNS). Gated to expert tier. Full design in the device-sync memory — read it before touching `src/sync/`. **Compartment-aware (K4, additive):** `buildBundle`/`applyBundle` (and `exportEncryptedBundle`/`importEncryptedBundle`) thread an optional `recipientUserId` (send) / `localUserId` (receive) using the core multiuser primitives (`rowsForRecipient` / `compartmentOf` / `canAccessCompartment`) — a row tagged `compartment = "private:<userId>"` reaches ONLY that user. Untagged/`shared` rows, or omitted options, sync exactly as pre-K4 (inert for single-user). Tests: `src/sync/compartment.test.ts`.

### Demo capture system (`demo/` + `@mydemo/core`, dev-only)
A WebDriver harness (tauri-driver + WebdriverIO + ffmpeg/gifski) that drives the **real** built app through scripted scenarios and records GIFs/MP4s for the landing page. Built with `VITE_DEMO_MODE=1`; never part of a shipped app.
- **The engine is no longer in this repo.** It was extracted into a standalone, reusable package **`@mydemo/core`** at `c:\workspace\myDemo`, consumed via `"@mydemo/core": "file:../myDemo"` and run as raw TS by tsx. Every engine function takes a resolved `DemoConfig` (dependency injection — no module-level config singleton). See `~/.claude/projects/c--workspace-myFinance/memory/project_demo_rig_extracted.md` before touching the rig.
- **What lives in `demo/` here** is app content + thin glue only: `config.ts` (`defineConfig({...})`, re-exports `SAMPLE`/`DIRS`/`VIDEO`), `scenarios/*` + `scenarios/index.ts` registry (`types.ts` is a re-export shim of `@mydemo/core`), `edit/marketing.edl.ts`, `fixtures/`, `assets/music/`, `.bin/msedgedriver.exe`, and thin entries (`record.ts`/`build.ts`/`reset.ts`/`edit/render.ts`/`edit/tutorial.ts`) that pass `config` into package functions. The `demo:*` npm scripts are unchanged.
- **The demo-mode contract stays app-side**: `src/lib/demoMode.ts` (+ usages in `App.tsx`, `UnlockPanel.tsx`, `ExportButton.tsx`, `Import.tsx`) auto-unlocks the vault and skips native save dialogs so capture runs unattended. The package documents this contract but can't provide it.

The `.github/pages/` GitHub Pages landing site and `.github/workflows/release.yml` (app installers + Pages publish) are separate dev infra; release.yml does **not** publish the signed masters bundle (that's manual via the `masters:*` scripts).

## Project constraints to respect

This repo is built on hard constraints set by the owner. Before proposing changes that touch architecture, read:
- `~/.claude/projects/c--workspace-myFinance/memory/project_myfinance_stack.md` — locked tech decisions and why.
- `~/.claude/projects/c--workspace-myFinance/memory/project_phase_roadmap.md` — delivery history and current toolchain/build state.
- `~/.claude/projects/c--workspace-myFinance/memory/project_excel_format.md` — default Excel schema + import wizard requirements.
- `~/.claude/projects/c--workspace-myFinance/memory/project_finite_set_inputs.md` — FiniteSetInput / master-data convention.
- `~/.claude/projects/c--workspace-myFinance/memory/project_device_sync.md` — LAN sync architecture.
- `~/.claude/projects/c--workspace-myFinance/memory/project_android_libsodium.md` — Android libsodium toolchain.

Short version: client-only, no backend, no web target, no LLM in product logic, Excel is the interchange format, single configurable currency, FY start = Jan or April. Outbound network is receive-only (pull signed public reference data; upload nothing).

### Data & telemetry philosophy

myFinance is **receive-only**. There is no backend, so the app *cannot* and *does not*
send any user data to us or to any server. Local usage telemetry (e.g. the app-launch
log, migration 0018) stays entirely on the user's device and is used only to **unlock
features locally** — it is never transmitted. Outbound network calls exist solely to
*pull* public reference data that improves the experience (the live master APIs, and the
over-the-air master/partner updates from GitHub Releases) — they upload nothing.

Future third-party integrations will be **opt-in** and one-directional wherever possible:
most exist to *receive* data for a better UX. Where an integration must send anything, it
sends only the **minimum required** for that feature to function, and only with the user's
explicit consent. No analytics, no phone-home.
