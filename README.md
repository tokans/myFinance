# myFinance

A client-only personal finance and family-readiness tracker. Desktop and mobile, no backend, no cloud — devices sync directly over your local Wi-Fi when you want them to. Excel is the import/export interchange format.

- **Stack:** Tauri 2 (Rust shell) + React 18 + TypeScript + Vite + Tailwind, SQLite via `tauri-plugin-sql`, encrypted credential vault via `tauri-plugin-stronghold`, plus the dialog / fs / os / http / notification / opener plugins.
- **Targets:** Windows / macOS / Linux desktop and Android / iOS. **No web target** — SQLite and the vault only exist inside the Tauri runtime.

## Features

**Highlights**

1. **Net worth over time** — monthly snapshots of every account, with month-over-month and financial-year trends.
2. **Per-account growth trend** — view the growth trend of each account over time, not just your total.
3. **Excel in, Excel out** — import your existing spreadsheet and export back to it; Excel stays the source of truth you own.
4. **Tax helper** — import official ITR JSON exports and get an advisory ITR-form recommendation.
5. **Goals & projections** — set targets and see realistic ETAs based on your actual saving pace.
6. **FIRE calculator** — project your path to Financial Independence / Retire Early: target corpus, safe withdrawal, and the age you get there.
7. **Encrypted vault** — account credentials protected by a master password (Argon2id + Stronghold); no plain text, ever.
8. **Emergency & estate planning** — size your emergency fund against real expenses, and keep nominee and estate details organised for the people who'll need them.
9. **Sync over your own LAN** — sync between desktop and mobile directly over your own Wi-Fi; nothing is ever shared over the internet.

**Core tracking**

- Accounts (bank, cash, credit, investment, loan, other) and monthly snapshots stored in SQLite.
- Excel import wizard that auto-detects the default schema (one sheet per month, col A = item, col B = value) and falls back to a per-sheet questionnaire only when the format is non-standard. Formula-aware data-region detection for messier sheets. Also handles cash-flow workbooks (credit/debit columns → running balance), multi-column rows (one account per column), credit-card columns as separate liabilities, and optional maturity / contact / emergency columns — plus zero-fill for accounts missing from a month.
- Excel export with native Tauri save dialog (desktop) or browser download fallback.
- Dashboard with month-over-month delta, financial-year-to-date delta (January or April FY start), and custom-anchor delta. Recharts trend line.
- Goals with progress bars and trailing-3-month ETA projection.
- Tax module (India): import official ITR JSON exports, manual entry of income / deductions / payments, and an advisory ITR-form recommendation wizard.
- Argon2id-derived master password unlocks a per-account credential vault stored in Stronghold's encrypted snapshot.

**Planning**

- **FIRE / retirement calculator** — a deterministic, multi-step planner: FIRE corpus (inflation-adjusted retirement spend ÷ safe withdrawal rate, depletion-modeled to life expectancy), time-to-FIRE, required savings, Lean/Coast/Fat classification, a sensitivity table, and a year-by-year simulation that models marriage / child income events. Cost-of-living uses a baked city index + cross-currency PPP (no API). Exports a self-contained HTML→PDF report.
- **Reminders** — user-created plus auto-derived reminders (FD maturities, document expiries, insurance renewals), bucketed by due date, with a once-per-sweep native OS notification for anything due.

**Family readiness (estate)**

- A `/estate` hub for preparing so family can locate assets and act in an emergency: **People** (the shared contact hub — nominees, executors, attorneys, claims/emergency contacts), encrypted **Documents**, an **ICE medical card**, **Insurance** coverage-gap analysis, **Nominees / holdings** (co-holders, beneficiaries, holding modes), **Will** and **Incapacity** (PoA / advance medical directive) metadata, **Liquidity** (survivor-operable assets + emergency fund), progressive-**Access** tiers, annual / life-event **Review** checklists, a plain-text **Family Pack** briefing, and a JSON or passphrase-encrypted **Register Export**.
- **Emergencies / ICE** — per-account "who to call / what to do" prep with click-to-call, plus the printable medical card. Deterministic keyword matching only; a disclaimer is always shown.

**Reference data, engagement & sync**

- **Offline-first master inputs** — set-valued fields (country, city, currency, institution, relationship, professional type, life goals) use a shared autocomplete backed by baked JSON, optional live public APIs, user-added "Other" values, and signed **over-the-air reference-data updates** (Ed25519-verified, pulled from GitHub Releases; receive-only). Includes an optional curated **professional partners** directory.
- **Engagement tiers & feature gating** — usage-earned newcomer → regular → expert tiers unlock features (tax, FIRE, emergency planning, device sync); an optional **patron** unlock is a signed file the user drops in, verified on-device (no payment callback). All usage telemetry stays on the device.
- **Device-to-device sync** — two-way, last-writer-wins sync directly between your own devices over the same Wi-Fi LAN, paired with a 6-digit code. No backend, no cloud; all crypto and merge logic is client-side. Expert-tier feature.

## Quick start

Prerequisites: Node.js 18+, Rust toolchain (`winget install Rustlang.Rustup` on Windows), and the WebView2 runtime on Windows.

```bash
npm install
npm run tauri:dev     # Full app — required for anything that touches SQLite or the vault
```

For a quick browser-only preview of the UI (no database, no vault):

```bash
npm run dev           # http://localhost:1420
```

Pages that depend on SQLite display an amber "needs the desktop app" banner when run in pure browser mode.

## Building installers

```bash
npm run tauri:build
```

Output (Windows):

- `src-tauri/target/release/bundle/nsis/myFinance_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/myFinance_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/myfinance.exe`

On Windows you can double-click `build.bat` instead — it checks for `cargo` / `npm` and runs the same command.

### Mobile

```bash
npm run tauri:android:init    # one-time
npm run tauri:android:dev     # needs Android SDK + NDK + JDK 17
npm run tauri:ios:init        # Mac + Xcode only
```

## Tests

```bash
npm test              # Vitest unit tests (domain logic, Excel parser, ITR recommendation)
npm run test:watch    # Vitest in watch mode
npm run test:e2e      # Playwright end-to-end against the Vite dev server
npm run test:e2e:ui   # Playwright in headed/UI mode
```

The unit suite covers the pure modules under `src/domain`, `src/excel`, and `src/tax` — anything that doesn't need the Tauri runtime. The Playwright suite drives the browser build of the app and exercises navigation, the Settings page, and the Excel import wizard up to (but not including) the SQLite commit step. Tauri-backed pages render the desktop-only banner in browser mode and the tests assert on it.

There is no E2E coverage for SQLite-backed flows (commit import, monthly update wizard, account CRUD). Those need either a manual smoke test in `npm run tauri:dev` or a `tauri-driver` setup, which isn't wired up here.

Ad-hoc parser harnesses also live under `scripts/test-*.ts` and are runnable with `npx tsx scripts/<file>.ts` — useful when debugging the Excel formula heuristics or the ITR parser against a real file.

## Repository layout

```
src/
  App.tsx              HashRouter + theme applier + idle startup work
  components/          Layout shell + page-specific components
    ui/                Tailwind / shadcn-style primitives (button, card, input, label, select)
    layout/            AppShell, FeatureGuard (feature gating)
    forms/             FiniteSetInput (master-data autocomplete)
    accounts/          AccountForm
    snapshots/         SnapshotForm
    vault/             UnlockPanel, CredentialPanel
  pages/               One file per route (~28: dashboard, accounts, tax, estate/*, fire, sync, …)
  db/                  Typed wrappers over the Tauri SQL plugin
    client.ts          getDb() — throws outside Tauri
    accounts/snapshots/goals/settings/tax/people/holdings/documents/health/
    insurance/will/incapacity/access/reminders/usage/masterOptions/partners …
  domain/              Pure functions: month math, dashboard, goals, FIRE, insurance,
                       liquidity, will, nominations, ice, access, review, reminders …
  excel/               readWorkbook, parseMonthFromSheetName, detectSheet,
                       extractRows, previewImport, commitImport, export
  tax/                 ITR JSON parser + form-recommendation decision tree
    schemas/           Official ITR JSON Schema files (AY 2026-27)
  masters/             Reference-data registry, baked JSON, live fetch, signed OTA updates
  sync/                Device-to-device LAN sync: bundle, merge (LWW), spec
  stores/              Zustand stores (settings, vault, tier, gating)
  vault/               Stronghold session wrapper + document crypto (per-device DEK)
src-tauri/
  src/lib.rs           Plugin registration + Argon2id master-password derivation
  src/sync.rs          LAN sync transport (dumb encrypted byte pipe over tiny_http + mDNS)
  migrations/          Legacy SQL files — historical reference only (schema is now TS descriptors + aux-SQL on the shared suite.db; the per-app migration array is retired)
  capabilities/        Tauri permission allowlist
  tauri.conf.json      App identity, window config, CSP, bundle targets
demo/                  Dev-only WebDriver demo-capture harness (marketing GIFs)
e2e/                   Playwright specs
scripts/               Ad-hoc tsx harnesses + masters/patron signing tooling
```

## Architectural constraints

These are fixed by design — please don't propose changes that break them:

- **Client-only.** No backend, no cloud, no web target. The app must run with the network unplugged; device sync is peer-to-peer over the local LAN only.
- **Receive-only networking.** Outbound calls exist solely to *pull* signed public reference data (live master APIs and over-the-air master/partner updates from GitHub Releases) — they upload nothing. Usage telemetry stays on the device and only unlocks features locally. No analytics, no phone-home.
- **Excel is the interchange format.** Default schema: one sheet per month, col A = item, col B = value.
- **No LLMs in product logic.** Forms ask the user about date format / header row / column mapping when needed; all calculations, checklists, and recommendations are deterministic.
- **Single configurable currency.** No FX. User picks once (default INR).
- **FY start configurable: January or April.** Both code paths must work.

## Security notes

- The master password is derived with **Argon2id** (m_cost=15000 KiB, t_cost=2, p_cost=1, 32-byte output, constant per-app salt). The derived key encrypts the Stronghold snapshot at `<appDataDir>/vault.stronghold`. **If the user forgets the master password, the vault is unrecoverable** — there is no recovery mechanism by design.
- The salt is constant per application. This is acceptable for a single-user local app because the password itself is the only secret; it would not be safe for a multi-user or networked deployment.
- The webview enforces a Content Security Policy that restricts script and style sources to `self` plus Tauri's IPC scheme. Style is `'unsafe-inline'` because Tailwind injects styles at runtime.
- Tauri filesystem capability is scoped to `$DOCUMENT/**` and `$DOWNLOAD/**` for reads and `$DOCUMENT`/`$DOWNLOAD`/`$APPDATA` for writes — the import wizard does not need wider home-directory access because it reads files via the browser `File.arrayBuffer()` API, not the FS plugin.

## License

Personal project, no public license set.
