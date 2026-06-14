# Demo capture rig

Regenerate the README GIFs by driving the **real** app through real user
interactions and recording the window. This is **dev tooling** — none of it
ships. Product code is only touched behind `import.meta.env.DEV` /
`VITE_DEMO_MODE`, so production builds are unaffected.

> **Run it yourself, in an interactive desktop session.** The rig opens a real
> app window and screen-records it. It will not work headless / over a
> non-interactive remote session, and it is **not** launched automatically.

---

## Prerequisites

Five external tools. The rig augments `PATH` for child processes, but they must
be installed:

| Tool | What for | Install (Windows) | macOS | Linux |
|------|----------|-------------------|-------|-------|
| **Node 20+** | runs the rig (tsx) | bundled with the repo toolchain | `brew install node` | distro pkg |
| **Rust + cargo** | builds the Tauri binary; installs the two cargo tools below | <https://rustup.rs> | rustup | rustup |
| **ffmpeg** | screen capture + transcode | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `apt install ffmpeg` |
| **gifski** | MP4/Y4M → GIF | `cargo install gifski` | `cargo install gifski` | `cargo install gifski` |
| **tauri-driver** | WebDriver bridge for Tauri | `cargo install tauri-driver --locked` | same | same |

Plus a **native WebView driver matched to your browser engine**, vendored under
`demo/.bin/`:

- **Windows** — `msedgedriver.exe` matching your installed Edge/WebView2 version.
  Find your version (`Get-AppxPackage *WebView*`, or `msedge://version`), then
  download the matching `edgedriver_win64.zip` from
  <https://developer.microsoft.com/microsoft-edge/tools/webdriver/> and extract
  `msedgedriver.exe` to `demo/.bin/`.
- **macOS/Linux** — Tauri uses WebKitWebDriver (`WebKitWebDriver` /
  `webkit2gtk-driver`); point `TOOLS.edgeDriver` in `demo/config.ts` at it.

`webdriverio` is already a dev dependency (`npm install`).

---

## How to run

```powershell
# From the repo root, in your own terminal:
.\demo\run-demo.ps1                         # build + record scenario 01
.\demo\run-demo.ps1 -Scenario 01-basic-import
.\demo\run-demo.ps1 -All                    # every registered scenario
.\demo\run-demo.ps1 -GifsOnly               # re-encode existing MP4s → GIF
.\demo\run-demo.ps1 -NoBuild                # skip the build, use current artifacts
```

`run-demo.ps1` checks tools, force-builds the demo bundle, then records. The
underlying npm scripts (cross-platform) are:

```bash
npm run demo:build          # force-build demo bundle (frontend + debug binary)
npm run demo:reset          # wipe app DB + vault only
npm run demo:single -- 01-basic-import
npm run demo:all
npm run demo:gifs           # re-encode MP4s → GIF, no recording
```

> `npm run … -- --build` does **not** work — npm swallows `--build`. Use
> `npm run demo:build` (or `run-demo.ps1`, which builds first).

Output lands in `demo/output/` (git-ignored) as `<scenario>.mp4` + `<scenario>.gif`.

---

## How it works

```
demo/
  config.ts            window/tool paths, sample-data paths, GIF canvas, app-data dir
  reset.ts             delete <appDataDir>/myfinance.db (+ wal/shm) and vault.stronghold
  build.ts             force-build entry (frontend + cargo)
  record.ts            orchestrator + scenario registry
  run-demo.ps1         user-facing launcher (tool check → build → record)
  lib/
    build.ts           vite build (VITE_DEMO_MODE=1) + cargo build (debug)
    server.ts          vite preview on :1420 (serves the demo dist to the debug binary)
    wdio.ts            tauri-driver spawn + WebdriverIO session + test-id helpers
    win.ts             foreground the window, measure its client rect (DPI-aware)
    capture.ts         ffmpeg gdigrab desktop-region capture; MP4 → Y4M → GIF
  scenarios/
    types.ts           Scenario contract + Helpers
    01-basic-import.ts implemented
  fixtures/            auxiliary inputs (e.g. ITR JSON for the tax scenario)
  output/              MP4 + GIF (git-ignored)
  .bin/                vendored msedgedriver + a backup of your real app DB
```

Per scenario: **reset app data → serve the demo dist on :1420 → launch the debug
binary via tauri-driver (maximized by `--demo`) → foreground + measure the
window's client area → ffmpeg captures that region → run the scenario → stop
ffmpeg → gifski.**

**Per-scenario isolation.** `demo:all` (and any multi-scenario invocation) runs
**each scenario in its own child process**. Driving many WebDriver sessions from
one long-lived process wedges tauri-driver after a couple of runs ("query is not
supported" → `UND_ERR_SOCKET` cascade); a fresh process per scenario lets the OS
fully tear down tauri-driver/Edge between runs. `demo:single` is already one
process per scenario.

**Why a dev server?** The debug Tauri binary runs in dev mode and loads its UI
from `devUrl` (`http://localhost:1420`). Instead of `tauri dev`, the rig serves
the already-built demo `dist/` with `vite preview` on that port, so the binary
loads the demo-mode UI unchanged.

**Window & framing.** `--demo` **maximizes** the window to use the whole
available screen (no resolution changes needed). Each GIF is then normalized to
a fixed **1024×640 (16:10)** canvas: the capture is scaled to fit and
**black-padded**, so every GIF is identically framed regardless of the recording
machine's resolution or DPI. Change the canvas in `demo/config.ts` (`CAPTURE.gifCanvas`).

**File upload.** WebDriver can't drive an OS file picker, so scenarios push an
absolute path straight into the (hidden) `<input type="file">` via the WebDriver
file-upload channel (`addValue`).

**Native dialogs / vault (`VITE_DEMO_MODE`).** When built with the flag:
- the credential vault auto-unlocks with `demo1234` (`UnlockPanel.tsx`),
- Excel export and the import-template save skip the native save dialog and
  write to `VITE_DEMO_OUTPUT_DIR` (= `demo/output/`) — see
  `ExportButton.tsx`, `Import.tsx`, and `src/lib/demoMode.ts`.

All of the above is gated so a normal `tauri build` is unaffected.

---

## Scenarios

The app navigation changed (Import/Export are no longer top-level nav items;
Tax/FIRE/Emergency are progressively unlocked). Scenarios reach non-nav screens
by hash route (`goto`) and satisfy feature gates through the data they import.

All 16 montage scenarios are implemented and recording end-to-end. 01–11 cover
import/dashboard/goals/reminders/tax/settings; 12–16 cover the features that had
grown past the original rig — Excel export, the FIRE planner, and the estate
suite (People, Insurance, Health/ICE, Family pack). Scenario **20** is the
standalone single-take tutorial (see *Finished videos › Tutorial*).

| # | id | What the GIF shows |
|---|----|--------------------|
| 01 | `01-basic-import` | `01-networth-basic.xlsx` → auto-detect default schema → preview → commit → dashboard MoM + FY deltas |
| 02 | `02-credit-debit-import` | `02-cashflow-credit-debit.xlsx`: credit/debit columns → running-balance carry-forward → dashboard |
| 03 | `03-estate-readiness-import` | `03-estate-readiness.xlsx` → import → Emergencies page lists emergency-ready accounts |
| 04 | `04-multi-column-import` | `04-multi-column-assets.xlsx`: one row → several accounts on the Accounts list |
| 05 | `05-wizard-fallback` | `05-needs-wizard.xlsx`: manual review wizard (header row, column roles, month) → commit |
| 06 | `06-monthly-update` | Monthly-update wizard for the current month → dashboard updates live |
| 07 | `07-account-add-vault` | Add an account → detail page → fill an encrypted vault credential (form). **Save not shown** — see note below. |
| 08 | `08-goal-with-eta` | Create a savings goal → goal row shows progress + projected ETA |
| 09 | `09-reminder-emergency` | Add a reminder → it surfaces in the Reminders list under its due bucket |
| 10 | `10-tax-itr-import` | Import a fixture ITR JSON → parsed income/deductions/payments + unmapped-sections panel → save |
| 11 | `11-fy-start-toggle` | Settings FY-start April → January → dashboard since-FY-start delta recomputes |
| 12 | `12-excel-export` | One click on the Dashboard exports the whole portfolio back to `.xlsx` (default schema; demo-mode skips the save dialog) |
| 13 | `13-fire-calculator` | FIRE locked → add a Healthy Retirement goal *in place* to unlock → walk the multi-step planner → computed FIRE number, progress & savings gap |
| 14 | `14-people-insurance-gap` | Add a Person, then set income + a term policy on Insurance → the coverage-gap assessment recomputes live |
| 15 | `15-health-ice-card` | Fill the health profile → the grab-and-go ICE card builds live, with the emergency contact from a Tier-0 person |
| 16 | `16-estate-family-pack` | The Estate readiness hub → generate a plain-language family briefing from a live snapshot of accounts/people/insurance |
| 20 | `20-full-tutorial` | **Single-take tutorial** (`solo`, excluded from `demo:all`): one import of `06-tutorial-complete.xlsx` → full tour (dashboard → goals → FIRE → people → insurance → health/ICE → estate hub → family pack → export) with `h.mark()` captions → `tutorial.mp4` |

> **Scenario 13 — FIRE unlock.** FIRE is gated on a Healthy Retirement goal, so
> the scenario seeds only balance history off-camera and creates the goal **on
> camera** via the locked screen's in-place `RetirementGoalDialog` — capturing
> the unlock moment itself. The wizard's per-step validation only requires age,
> savings, and monthly retirement spend; every other field has a sensible default
> (and net worth prefills from the seeded history), so the scenario types just
> those four and accepts defaults elsewhere.

> **Scenarios 14–16 — estate save dialogs.** The estate pages had no
> `data-testid`s, so building these added them (Fire wizard, PersonForm,
> Insurance, Health, FamilyPack, the locked-feature CTA, the Estate hub). The
> scenarios stop at the on-screen payoff (coverage cards, the built ICE card, the
> generated briefing text) and deliberately do **not** click the file `Export`
> buttons on Health/FamilyPack/Register/Access — those call the native save
> dialog directly (only the Excel export and import-template paths are
> demo-mode-redirected), which would block an unattended run. Capture the export
> tails by hand (see the checklist).

> **Scenario 07 — vault save caveat.** The credential *attach* path had a real
> foreign-key bug (a stray `SELECT last_insert_rowid()` colliding with migration
> 0021's insert trigger) — **fixed** in `src/db/accounts.ts`. Separately, under
> the automated **debug** build, `tauri-plugin-stronghold`'s `stronghold.save()`
> could hang (the credential inserts, but the snapshot write never resolves).
> `src/vault/stronghold.ts` now **serializes all vault operations** through a
> single op-chain so a save can't race a `getCredential`/`refresh` or a second
> `unlock` on the same snapshot — the most likely self-inflicted cause. Until
> that's confirmed in a **release** build, the scenario still stops at the filled
> form rather than clicking Save (see the checklist).

Several scenarios seed prerequisite data **off-camera** via a `setup()` hook
(e.g. 06/08/10/11 import the basic workbook first so there are accounts/history)
so the GIF focuses on the feature itself. Feature gates (Tax needs an account,
FIRE needs a goal, Emergency needs an emergency action) are satisfied by that
seeded data.

Add a scenario by creating `demo/scenarios/NN-name.ts` (default-export a
`Scenario`, optionally with `setup()`) and registering it in `demo/record.ts`.
Add any `data-testid`s the scenario touches to the relevant component.

### Conventions
- `data-testid` is kebab-case and scoped: `nav-<label>`, `import-dropzone`,
  `dashboard-mom-delta`, `dashboard-export-button`.
- Prefer real entry points (nav clicks, on-screen buttons); use `goto("/route")`
  only for screens that aren't in the nav.

---

## Finished videos (post-production)

Two finished videos are built from the recordings: a ~60s **marketing montage**
and a full **tutorial** with on-screen captions. The post-production is pure
`ffmpeg` (already a prerequisite); nothing new to install.

### One command (the easy path)

```powershell
.\demo\make-video.ps1                  # fresh record + 60s marketing video
.\demo\make-video.ps1 -Video tutorial  # fresh record + full tutorial video
.\demo\make-video.ps1 -Video both      # both, one go
.\demo\make-video.ps1 -NoRecord        # re-edit from existing clips (fast: no build/record)
```

`make-video.ps1` checks tools → builds the demo bundle → records the scenarios
that video needs → composes the finished `.mp4` into `demo/output/video/`, then
opens the folder. Use `-NoRecord` to just re-edit (swap music, tweak the cut)
without re-recording. The underlying cross-platform npm scripts:

```bash
npm run demo:marketing           # record the 16 clips + render marketing.mp4
npm run demo:tutorial            # record the single-take tour + render tutorial.mp4
npm run demo:video:marketing     # render marketing.mp4 from existing clips
npm run demo:video:tutorial      # render tutorial.mp4 from the existing recording
```

### Marketing cut — `demo/edit/marketing.edl.ts`

A ~60s montage of all 16 features, driven by a declarative **EDL** (edit-decision
list, plain TypeScript data): an ordered list of *segments* — either a **clip**
sliced from a scenario MP4 (`in`/`out` + optional `rate` speed-ramp + lower-third
`caption`) or a generated **title card**. `compose()` (`demo/edit/compose.ts`):

1. renders each segment to a normalized intermediate — scaled-to-fit and
   **black-padded** to a single 1920×1080 canvas (the GIF-path trick), so
   mixed-resolution captures join seamlessly;
2. probes each intermediate's real duration (so trimming can't desync the fades);
3. **crossfades** them with `xfade` (set `transition: 0` for hard cuts);
4. lays a **faded, volume-ducked music bed** under the whole thing.

Each clip grabs the scenario's *payoff tail* with a one-line caption; the slow
vault scenario is sped up 2.5×; intro/outro cards bookend it. Every
`in`/`out`/`rate`/`caption` is freely editable — re-run `npm run
demo:video:marketing` to recompose from the existing MP4s in seconds. To re-pick
payoff moments, eyeball the source timestamps in `demo/output/<id>.mp4`.

### Tutorial — single take + on-screen captions

The tutorial is **one continuous recording** (`demo/scenarios/20-full-tutorial.ts`,
a `solo` scenario so it's excluded from the marketing set) driven by **a single
import file** — `sample-data/06-tutorial-complete.xlsx` (6 months × ~12 account
types + maturity/contact/emergency columns; regenerate via
`node scripts/build-sample-data.mjs`). That one import unlocks the whole tour:
dashboard → goals → FIRE → people → insurance → health/ICE → estate hub → family
pack → export. *(Tax is omitted on purpose — it ingests an ITR JSON, not the
Excel file; see scenario 10 for that flow.)*

The on-screen captions come from the scenario itself: each `h.mark("…")` call
drops a timestamped marker, the rig writes them to `<id>.timeline.json` (relative
to capture start), and `demo/edit/tutorial.ts` turns each mark into a lower-third
caption — generated as an **ASS subtitle** file and burned in with libass — shown
from its moment until the next mark. So **editing the captions = editing the
`h.mark()` strings** in the scenario; no separate subtitle file to maintain.
Re-render anytime with `npm run demo:video:tutorial` (recomposes from the existing
recording + timeline; no app run needed).

### Music (royalty-free, no attribution)

Both videos read a track from `demo/assets/music/` (`marketing.mp3` /
`tutorial.mp3`); if a file is absent the video renders **silent** rather than
failing. The shipped placeholder is a 70s excerpt of **"Calm Pills — It Was
Beautiful"** (Uplifting Pills), **CC0 1.0 Universal (public domain)** — no
attribution required, commercial use OK. Source:
<https://archive.org/details/CalmPills> (license verified via the archive.org
metadata API: `creativecommons.org/publicdomain/zero/1.0/`).

**To use upbeat music for the marketing cut:** drop your own `.mp3` at
`demo/assets/music/marketing.mp3` and re-render (`-NoRecord`). Good no-attribution
sources are **Pixabay Music** and **Chosic → "no attribution"** — both need a
browser download (Pixabay blocks scripted requests via bot-protection; archive.org
search was used here because it exposes a verifiable per-track license API, but
its *popular-genre* "CC0" tags are unreliable, so verify any track you pull from
it). The bed is looped + `-shortest`-cut to the video length with fade-in/out;
tune `volume`/`fadeIn`/`fadeOut` in the EDL's `music` block (marketing) or
`tutorial.ts` (tutorial).

---

## Manual-recording checklist (not automated)

Some shots are better captured by hand — record these directly with your screen
recorder (or OBS), then drop them in `demo/output/`:

- [ ] **Cold-start reveal** — first launch, vault setup, empty dashboard → first
      import. (The rig resets state but starts each scenario already past launch.)
- [ ] **Android / mobile pass** — run `npm run tauri:android:dev` on an emulator
      and capture the bottom-tab mobile layout (the rig is desktop-only).
- [ ] **Cinematic cross-page moments** — smooth transitions across Dashboard →
      Goals → FIRE → Emergency planning that read better with human pacing than
      scripted waits.
- [ ] **Feature-unlock moment** — the lock icon on a nav item turning into the
      unlocked screen after the prerequisite action.
- [ ] **Vault credential save (scenario 07 tail)** — clicking Save and seeing
      the stored credential. The automated rig stops before Save because
      `stronghold.save()` could hang under the debug + tauri-driver combo.
      Vault ops are now serialized (`src/vault/stronghold.ts`) to rule out
      self-inflicted save/unlock races; confirm the save round-trip in a
      **release** build, then capture this step (and re-enable Save in
      `demo/scenarios/07-account-add-vault.ts`).
- [ ] **Estate file exports** — the `Export` tails of Health (ICE `.txt`),
      Family pack (`.txt`), Register (encrypted `.enc` / JSON), and Access
      (encrypted handover package). These call the native save dialog directly,
      which the demo-mode redirect doesn't cover, so they're hand-captured.
- [ ] **Nominees & Will reconciliation** — assign nominees + shares per account
      (holding-mode + per-person Radix pickers), record the Will, and show the
      nominee-vs-beneficiary reconciliation flip from ⚠ mismatch to ✓ match.
      Driveable but Radix/portal- and cross-page-heavy; left manual for now.
- [ ] **Device-to-device sync** — needs two devices on a LAN; record the pairing
      + last-writer-wins merge by hand (the rig is single-instance, desktop-only).
- [ ] **OTA masters / Patron unlock** — both consume signed+encrypted files
      (a Releases bundle / a `.tokans` donation file). Stage the file, then
      capture the in-app apply/unlock by hand; the signing keys are offline.
- [ ] **FIRE PDF report + refine panel** — scenario 13 stops at the computed
      number; the refine-assumptions panel (live recompute) and the
      `Download PDF report` (print dialog) read better hand-paced.

---

## Product issues surfaced while building the rig

Driving the real app end-to-end turned up real-app issues, not just rig ones:

1. **Vault credential attach — foreign-key failure (FIXED).** `attachCredential`
   used a separate `SELECT last_insert_rowid()` to get the new `vault_entries`
   id; with the SQL plugin's connection pooling and migration 0021's AFTER INSERT
   trigger, that returned a wrong/zero id, so `accounts.credential_id` was set to
   a non-existent row → `FOREIGN KEY constraint failed`. Attaching *any*
   credential was broken (since migration 0021). Fixed in `src/db/accounts.ts` to
   use the INSERT's own `lastInsertId` (matching `createAccount`).

2. **Vault credential save — `stronghold.save()` hang (HARDENED, verify in release).**
   After the FK fix, the credential *inserts* but `stronghold.save()` (snapshot
   write) could fail to resolve under the automated **debug** build, leaving a
   stuck "Saving…". `tauri-plugin-stronghold`'s snapshot writer isn't safe against
   overlapping saves or two `Stronghold.load` handles on one snapshot path, so a
   save racing a `getCredential`/`refresh`, or a second `unlock`, can wedge on a
   file lock — which also explains the intermittent unlock hang. **Mitigated** in
   `src/vault/stronghold.ts` by serializing every vault operation through a single
   op-chain (one operation at a time; durability's inline `save()` is unchanged).
   Whether this fully resolves the debug-build hang vs. it being tauri-driver
   specific still needs a **release-build** confirmation; scenario 07 stays
   stopped at the filled form until then.

3. **Demo-mode Excel export wrote outside the fs scope (FIXED).** In demo mode
   the Dashboard export and import-template save skipped the native dialog and
   wrote to an **absolute repo path** (`demo/output/`). But `capabilities/default.json`
   only allows fs writes under `$DOCUMENT` / `$DOWNLOAD` / `$APPDATA`, so the
   write was rejected, the export fell into its `alert()` catch, and the button
   never reached "Exported" — surfaced the first time a scenario (12) exercised
   it. Fixed in `src/lib/demoMode.ts` (`demoSaveName`) + `ExportButton.tsx` /
   `Import.tsx`: demo writes now go to `BaseDirectory.AppData` (an allowed scope).
   The rig never reads these files — the GIFs come from ffmpeg — so only the
   write needs to succeed.

4. **Capture contaminated by focus-stealing windows (FIXED, rig).** On a shared/
   active desktop, other windows (File Explorer, a chat app, OS toasts) could
   come to the foreground over the captured screen region mid-scenario, so the
   GIF showed *them* instead of the app. The rig now pins the app window
   **topmost** for the duration (`SetWindowPos` HWND_TOPMOST in `demo/lib/win.ts`),
   so nothing can draw over the capture region. Rig-only; no product impact.

5. **Net worth counted a negative-valued liability as positive (FIXED).**
   `totalsByMonth` negates liability-type rows (`THEN -s.value`), i.e. it expects
   liabilities stored as **positive** magnitudes (the convention the Dashboard,
   EmergencyOverlay, and merge logic all share). The `01-networth-basic.xlsx`
   sample stored the home loan as a **negative** value, so it was double-negated
   and *added* to net worth — GIFs showed ~₹1.57 Cr instead of ~₹7.6 Cr. Fixed in
   `src/excel/import.ts`: liability-account balances are normalized to their
   magnitude on import (`Math.abs`, mirroring the credit-card column path in
   `parse.ts`), so the stored sign is consistent no matter how the source
   spreadsheet writes debts. Sample data left as-is; re-record 08 + the
   dashboard/goal GIFs to pick up the corrected total.

## Troubleshooting

- **`port 1420 never opened`** — a stale `vite preview` is bound; kill the
  process holding the port and retry. (The rig binds `127.0.0.1` to avoid an
  IPv4/IPv6 mismatch.)
- **`Capture area … extends outside window area`** — the window wasn't
  maximized/on-screen; ensure `--demo` is in effect (rebuild) and nothing is
  covering the window.
- **Black frames** — expected with ffmpeg `title=` capture of WebView2; the rig
  uses desktop-region capture of the client rect to avoid this.
- **`element still not displayed`** — the target is hidden (e.g. a file input);
  wait on a visible element and upload via `uploadFile`, or check the testid.
- **Your real data** — `demo/reset.ts` deletes the app-data DB. A backup of the
  pre-rig DB is at `demo/.bin/appdata-backup/`.
