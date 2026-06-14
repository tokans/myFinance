# TODO — going-live punch list (remaining external steps)

The signing/key gates (G3 patron, G4 suite trust-anchor, G5 masters) are **baked and
green** (`publisher-ci check` passes). What's left before a public release is external
and not yet done. Tracked here so the deploy gate isn't the only reminder.

## Code-signing the installers (G12) — do before marketing

> Status: **OPEN** — deferred (2026-06-13). Unsigned installers trigger SmartScreen
> (Windows) and Gatekeeper (macOS) warnings, so this must land before we drive real
> downloads. Distinct from the feed/grant keys in G3–G5.

**CI architecture (built 2026-06-14).** Signing requires a public-CI build SignPath can
origin-verify, so the release pipeline was split (dev history stays private):
- [mirror-to-public.yml](../.github/workflows/mirror-to-public.yml) runs in the **private**
  `anshumandas/myFinance` on a `v*` tag and pushes the release-state source as one squashed
  commit + tag into the **public** `tokans/myFinance`.
- [build-release.yml](../.github/workflows/build-release.yml) runs in **public** `tokans`
  (triggered by that tag): builds desktop + experimental mobile, **signs**, and publishes the
  Release + README + gh-pages. Depends on public repos only — `@mydemo/core` is now an
  OPTIONAL dep and the build runs `npm ci --omit=optional` (verified: `demo/` is outside the
  build). The `sign-windows` job and the macOS `APPLE_*` env are wired but **pass through
  unsigned** until the secrets below exist, so releases keep working pre-approval.

- [ ] **Windows (Authenticode) — SignPath Foundation (free OSS).** Prereqs: (1) ✅ MIT
  `LICENSE` + `"license":"MIT"` on both repos; (2) make `tokans/myFinance` public with Actions
  enabled; (3) apply at signpath.org/about pointing at the public repo + its `build-release.yml`
  CI (manual review, days–weeks). On approval: add the `SIGNPATH_API_TOKEN` secret to
  `tokans/myFinance` and fill the placeholder `organization-id` / `project-slug` /
  `signing-policy-slug` / `artifact-configuration-slug` in the `sign-windows` job (and confirm
  the action input names against the pinned version).
- [ ] **macOS (Developer ID + notarization).** Apple Developer enrollment ($99/yr) →
  Developer ID Application cert. Signing+notarization+stapling are handled by `tauri-action`
  in `build-release.yml` via env — no `notarytool` scripting and **no `tauri.conf.json` change**
  (Tauri reads `APPLE_SIGNING_IDENTITY` from env). Add these secrets to `tokans/myFinance`:
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- [ ] Verify a signed build installs without a security prompt on a clean Win + Mac
  (`signtool verify /pa /v` · `spctl -a -vvv -t install` + `stapler validate`).

## Real suite feed URL (part of G4) — DONE

- [x] Feed host set to the myFinance repo's rolling GitHub Releases tag
  (`https://github.com/tokans/myFinance/releases/download/suite-latest`) in both
  [publisher.trust.json](../publisher.trust.json) (`feed.baseUrl`) and
  [src/suite/config.ts](../src/suite/config.ts) (`SUITE_FEED_BASE_URL`), byte-identical.
  The release + masters are published here; sibling apps live at `github.com/tokans/<app>`.
  Remaining work is publishing the signed feed there (issuer side — see tokans todo).

## Issuer-side keys — tracked in tokans

The private/transport halves of the patron, masters, and suite-feed keys must be
installed on the tokans issuing side and the minting/signing flows wired. Tracked in
`tokans/backend/docs/TODO-myfinance-grant-issuer.md` (INFRA-PLAN Workstream S5).

## Other deploy gates (verified at `npm run deploy`)

- G11 e2e (ASK), G13 cross-account release infra — `PUBLISH_TOKEN` secret on the
  publisher repo, GitHub Pages enabled. Confirm at deploy time.
