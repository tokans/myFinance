# myFinance release checklist (the deploy gate)

This is the **canonical, machine-checkable** list of everything that must be true
before myFinance can be published. It is the data source for the `/deploy-release`
slash command (run via `deploy.bat` / `npm run deploy`): on each run, a Claude Code
agent verifies every gate **live**, walks you through the first unmet blocker, and
only tags + pushes a release once all **blocking** gates pass.

Sources of truth this consolidates:
[CLAUDE.md](../CLAUDE.md) · [docs/migration-report.md](./migration-report.md) ·
[docs/patron-and-partner.md](./patron-and-partner.md) ·
sharedCoreLib `CONTRACT.md` §6 + `THREAT_MODEL.md` + the `publisher-ci` toolkit.

Legend: **[BLOCK]** stops the deploy · **[WARN]** is surfaced but does not stop ·
**[ASK]** needs a human yes/no the agent cannot verify alone.

---

## G1 — Clean tree, on `main` · [BLOCK]
- **Verify:** `git status --porcelain` is empty **and** current branch is `main`.
- **Fix:** commit/stash changes; `git checkout main`.

## G2 — No TEST-ONLY / sample code ships · [BLOCK]
Fake reference data must not reach real users.
- **Verify (all must hold):**
  - `seedSamplePartners(` is **not** called in [src/App.tsx](../src/App.tsx).
  - [src/db/partners.sample.ts](../src/db/partners.sample.ts) does **not** exist.
  - `rg -n "TEST-ONLY" src` returns no production call sites.
- **Fix:** remove the `seedSamplePartners()` call + import in `App.tsx`, delete
  `src/db/partners.sample.ts`, and drop the `ENABLE_SAMPLE_PARTNERS` reconcile
  helper in [src/db/partners.ts](../src/db/partners.ts).

## G3 — Real grant (patron/partner) keys baked · [BLOCK]
- **Verify:** [src/lib/patronFile.ts](../src/lib/patronFile.ts) contains **neither**
  the all-zero hex pubkey `0000…0000` (64 zeros) **nor** the all-zero transport key
  `AAAA…AAA=`. (Those are the fail-closed placeholders.)
- **Fix:** `npm run patron:keys` once on a trusted machine, paste the printed
  `PATRON_PUBKEY_HEX` / `PATRON_TRANSPORT_KEY_B64` into `patronFile.ts`. Put the
  matching private + transport keys on the issuing (tokans.org) side. See
  [docs/patron-and-partner.md](./patron-and-partner.md) §"Going live".

## G4 — Real suite / publisher trust-anchor keys baked · [BLOCK]
Per `THREAT_MODEL.md` §2 these are a **role-separated hierarchy** (root → data /
code / snapshot / timestamp), all delegated from an **offline** root; the code role
uses k-of-n threshold signing.
- **Verify:** [src/suite/config.ts](../src/suite/config.ts) contains no all-zero
  pubkey `0000…0000` and no all-zero transport key `AAAA…AAA=`.
- **Fix:** run the offline publisher key ceremony, bake the public/transport halves,
  ensure each role chains to the root (`signedByRoot`).

## G5 — Real masters (OTA reference-data) keys baked · [BLOCK]
- **Verify:** the baked Ed25519 verify key + transport key under `src/masters/`
  are not placeholders.
- **Fix:** `npm run masters:keys` (offline); bake the public halves; the bundle
  pipeline is `npm run masters:pack` / `masters:sign`.

## G6 — `publisher-ci` security gate wired and green · [BLOCK]
The suite contract (CONTRACT.md §6.6/§6.8) makes this a required CI gate.
- **Verify (all must hold):**
  - `sharedcorelib-publisher-ci` is in `devDependencies`.
  - These scaffolded files exist: `sharedcorelib.security.json`,
    `publisher.trust.json`, `release.signing.json`, `deprecations.json`,
    `schema.manifest.json`.
  - `npx sharedcorelib-publisher-ci check` exits `0` (no findings ≥ `high`).
- **Fix:** `npx sharedcorelib-publisher-ci init`, fill `publisher.trust.json` /
  `release.signing.json` with the **real** keys from G3–G5, resolve every finding.
  Checks enforced: `trust-anchor`, `key-separation`, `update-metadata`,
  `kdf-floor`, `tls-only`, `dependency-pinning`, `deprecation-window`,
  `schema-merge`, `release-pipeline`.

## G7 — Offline feed-signing path present · [BLOCK]
CI must build/publish but **never hold signing keys** (THREAT_MODEL §2); the suite
feed is signed offline.
- **Verify:** `scripts/publish-feed.mjs` exists (scaffolded by `publisher-ci init`).
- **Fix:** complete `publisher-ci init`; sign + upload the feed offline.

## G8 — Version chosen and consistent · [BLOCK]
- **Verify:** `version` in [package.json](../package.json) equals `version` in
  [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json), and the chosen
  `vX.Y.Z` tag does not already exist (`git tag -l vX.Y.Z` empty). Warn if it is
  not greater than the latest existing tag.
- **Fix:** bump both files to the intended public version.

## G9 — Type-check + production build passes · [BLOCK]
- **Verify:** `npm run build` exits `0` (runs `tsc --noEmit` + Vite bundle).
- **Fix:** resolve the reported type/build errors.

## G10 — Unit/domain tests pass · [BLOCK]
- **Verify:** `npm run test` exits `0`.
- **Fix:** fix failing tests.

## G11 — End-to-end tests · [ASK]
- **Verify:** `npm run test:e2e` exits `0` (needs a built app + browser; may be slow).
- The agent asks whether to run e2e this pass; a deferral is recorded, not a pass.

## G12 — Installer code-signing configured · [WARN]
Unsigned installers trigger SmartScreen (Windows) / Gatekeeper (macOS) warnings.
- **Verify:** [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) declares a
  Windows `certificateThumbprint` and/or macOS `signingIdentity`; the release
  workflow notarizes on macOS.
- **Fix:** add an Authenticode cert (Windows) and Apple Developer ID + notarization
  (macOS). Distinct from the feed keys in G3–G5.

## G13 — Cross-account release infra ready · [ASK]
- **Verify (confirm with the user; `gh` where possible):**
  - `PUBLISH_TOKEN` secret is set on the **source** repo (`gh secret list`), a PAT
    with `contents: write` on `tokans/myFinance`.
  - GitHub Pages is enabled on the publisher repo (`gh-pages` / root).
  - The agent notes that `publisher-ci init` also scaffolds a growth-campaign job
    that files a marketing issue on each release — confirm that is wanted.

---

## DEPLOY (only when every [BLOCK] gate passes)
1. Re-confirm the version `vX.Y.Z` with the user.
2. Get an **explicit "yes, deploy"** — this is outward-facing and fires CI.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` (and `git push origin main` if main is
   ahead). The tag push triggers [.github/workflows/release.yml](../.github/workflows/release.yml),
   which builds Windows + macOS desktop bundles **and experimental Android (arm64
   `.apk`/`.aab`) + iOS bundles**, then publishes the release on `tokans/myFinance`.
   The mobile jobs are `continue-on-error` (unsigned for now), so a mobile build
   failure never blocks the desktop release.
4. Tell the user where to watch the run (`gh run watch` / the Actions tab) and stop.
