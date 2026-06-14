# Migration report — myFinance → sharedcorelib (current)

Branch: `migrate-sharedcorelib` (off `main`). **Not pushed; no PR.** Baseline and every
step kept the test suite green: **27 files / 207 tests pass** throughout.

## Context

myFinance was already ~80% migrated (most subsystems were already thin re-export shims
consuming the lib, committed on `main`). This pass completed the remaining appendix items
from `sharedCoreLib/MIGRATION_PROMPT.md`.

## What this pass did (4 items, 4 commits)

| # | Commit | Change |
|---|---|---|
| 1 | `2409e7f` | **Tiers** — `gamification.ts` now consumes `standardTopTiers` from `sharedcorelib/tiers`; only the earned ladder (Newcomer/Regular/Expert) stays local, decorated standard Patron/Partner appended. `TierContext extends PatronPartnerCtx`. Re-exports `hasPatronAccess` + a bound `becomePatronVisible`. |
| 2 | `4837570` | **Gating** — `gating.store.ts` passes `override: () => hasPatronAccess(getPatronState())`, so a Patron/Partner unlocks **all** features. |
| 3 | `07197a1` | **Grant** — `patronFile.ts` rebuilt on `sharedcorelib/grant` (`verifyGrant`/`createGrantReceiver`); local verify deleted. Added an anonymous **receive-only token channel** (`claimPatronByToken`) so donors need no email. |
| 4 | `c8092eb` | **Masters** — deleted `data/countries.json` + `data/currencies.json` (duplicates of the common masters); repointed `live.ts`'s country-name map to `getCommonBaked("country")`. Stale comment in `countryCurrency.ts` fixed. |

Net: **+127 / −1380 lines** (mostly the deleted country seed).

## Data-format compatibility (verified)

- **Patron `.tokans` files:** the lib's grant envelope (`{v:1, enc, sig}`, sig over the
  AES-GCM `iv‖ct‖tag`) is byte-identical to the previous format — existing files keep
  verifying. The 6 patron-file tests pass unchanged against the new lib-backed code.
- **Crypto/vault:** already on the lib (prior pass); the lib reads legacy pre-versioning
  formats, so existing export packages and sealed blobs still open (legacy round-trip tests
  `lib/packageCrypto.test.ts`, `vault/docCrypto.test.ts` pass).
- **Vault Argon2 salt** in `src-tauri/src/lib.rs`: **untouched.**
- Migrations remain append-only.

## Already done before this pass (consuming the lib)

`crypto` (`lib/packageCrypto.ts`), `vault` (`vault/docCrypto.ts`, `vault/stronghold.ts`),
`masters` verify+merge+store (`masters/verify.ts`, `masters/store.ts`, `masters/registry.ts`),
`reminders` (`lib/reminderSweep.ts`, `lib/notify.ts`, `domain/reminders.ts`), `env`
(`lib/environment.ts`), `ui` (`lib/utils.ts`), `ice` (`lib/emergency.ts`), `report`
(`lib/fireReport.ts`), `sync` kernel (`sync/merge.ts`), tier resolution + gating store
mechanisms. Step-2 deps (`sharedcorelib` file dep, `prebuild`, `@mydemo/core`, tsconfig
Bundler + skipLibCheck) are in place. `cities.seed.json` / `relationships.json` already removed.

## KEEP (app-specific — intentionally not migrated)

FIRE engine (`domain/fire*.ts`), ITR/tax, Excel import, report templates, pages, schema,
branding, app-specific masters (`institutions.json`, `professional-types.json`),
`lib/accessTiers.ts` (estate "who-sees-what", NOT engagement tiers), `PartnerPicker`/`people`
(financial people, NOT the Partner tier), `domain/ice.ts` (card builder vs the lib's keyword
extraction).

## Deferred (needs real keys or new UI — scaffold + TODO, NOT done here)

- **Security gate:** `sharedcorelib-publisher-ci` devDep + `init` + `check` not added — the
  trust manifest needs REAL baked keys to pass, and `init` also lays down the cross-account
  release pipeline + growth-campaign job. Do this when the real publisher keys exist.
- **Suite updater + marketplace:** `createSuiteUpdater` / `createAppCatalog` ("More" surface)
  not wired — needs the trust anchor + new UI + an `entitlements` adapter (from the grant).
- **Demos:** no `demo/` rig recorded this pass (the `@mydemo/core` devDep is present).
- **Patron backend:** `PATRON_CLAIM_BASE` is a fail-closed placeholder; the receive-only
  token channel is implemented but points at no real endpoint yet.

## Verification

- `npm test` (vitest): **207 pass** after every item.
- `git grep` for `data/countries` / `data/currencies` in `src`: no code references remain
  (only the now-fixed doc comment).
- e2e (playwright) **not run** (needs a built app + browser).
- `publisher-ci check` **not run** (no security config yet — see Deferred).

## To finish later

Wire the deferred items once real keys exist: `publisher-ci init` + fill `publisher.trust.json`
→ resolve gate findings; mount the suite updater + marketplace; record demos; point
`PATRON_CLAIM_BASE` at the real receive-only endpoint. Then merge `migrate-sharedcorelib`.
