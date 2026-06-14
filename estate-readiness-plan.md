# Estate Readiness — Phased Implementation Plan

Companion to [estate-readiness-features.md](estate-readiness-features.md). Maps all 12 spec
features onto myFinance's locked constraints and sequences them around the agreed priorities:
**Reminders → Health/ICE → Insurance → Nominees** (after the minimal shared foundation each
depends on).

## Implementation status (all phases built)

Phases 0–12 are implemented. Migrations 0008–0017 added; pure domain logic carries **154 passing
tests across 21 files**; every estate file type-checks cleanly (`tsc --noEmit` reports **zero** errors
in estate code). All 12 spec features are now wired behind the **Estate** nav hub (`/estate`).

| Phase | Feature | Domain tests |
|---|---|---|
| 0 Emergency action/contact | 1/8/9 (slice) | emergency |
| 1 People + Documents (encrypted) | foundation | docCrypto, peopleImport |
| 2 Reminders | 12 (+10 sched) | reminders |
| 3 Health / ICE | 8 | ice |
| 4 Insurance adequacy | 5 | insurance |
| 5 Nominees + holdings | 2 | nominations |
| 6 Will + reconciliation + template | 3 | will |
| 7 PoA / AMD | 4 | (CRUD + static guidance) |
| 8 Liquidity | 6 | liquidity |
| 9 Access tiers + audit + encrypted package | 9 | access, packageCrypto, registerSnapshot |
| 10 Life events + review | 10 | review |
| 11 Family pack | 11 | familyPack |
| 12 Register export | 1 + NFRs | registerSnapshot, packageCrypto |

**Verification status:**
- `tsc --noEmit` — **clean (0 errors)**. (The earlier Fire.tsx blocker has been resolved.)
- `vitest` — **173/173 passing** across 23 files (pure-domain + DB integration).
- **DB integration tests** (`src/db/reminders.int.test.ts`, `src/db/estate.int.test.ts`): the REAL db
  layer runs against an in-memory `node:sqlite` built from the **actual migration files**, so they also
  prove all 17 migrations apply cleanly and that FK cascades, joins, single-row upserts, and the
  reminders sync/prune/idempotency logic work end-to-end.
- Production bundle for the **Tauri target** (`TAURI_ENV_PLATFORM=windows` → chrome105) — **builds
  successfully**. This is the path `dev.bat` / `build.bat` use.
- Added `esbuild` as a devDependency — it was genuinely missing (vite peer dep `^0.27 || ^0.28`),
  which is why builds failed from the start.

**Remaining gaps (need the live app):**
- Bare `npm run build` (no Tauri env → `safari13` target) still fails: esbuild can't downlevel a Tauri
  plugin's modern destructuring to safari13. Pre-existing, unrelated to estate code, and NOT the build
  path used for releases (Tauri sets chrome105). Left as-is.
- The encrypted-document file round-trip and live Stronghold vault unlock can't run headless (need the
  Tauri FS + Stronghold plugins); covered by `docCrypto`/`packageCrypto` unit tests but still worth a
  one-off manual smoke test in the running app.

## Constraint fit (read first)

These are hard constraints from the owner (see `CLAUDE.md` + project memory). They shape — and in
two cases *cap* — the spec:

| Spec expectation | Our constraint | Resolution |
|---|---|---|
| Hosted vs local-first | Client-only, no backend, no web target | Everything in SQLite + Stronghold on device. No server-side anything. |
| Reminders via email / push / SMS (F12) | No backend | **In-app + OS-local notifications only** (add `tauri-plugin-notification`). Email/SMS/push are **out of scope** — they need a server. Surfaced to user, not silently dropped. |
| Dead-man's switch, M-of-N attestation (F9) | No backend, no always-on process | Reduce to **on-device manual unlock + local "last check-in" staleness flag**. True remote dead-man's switch is out of scope. |
| Trusted-contact *remote* access (F9) | Local-first | Tier sharing = **encrypted offline export package** a contact opens on their own device, not live remote access. |
| LLM-assisted Will drafting / recommendation | No LLM in product logic | Deterministic templates + rule trees only (same approach as `recommendItr.ts`). |
| Bulk data | Excel is the interchange format | Every feature that ingests rows reuses the `src/excel/` pipeline + the column-header auto-detection pattern added in Phase 0. |
| Currency | Single configurable currency | All money fields use the existing `currency` setting; no multi-currency math. |
| FY start | Jan or April | Review cadence / FY-anchored reminders use the existing `fy_start_month` setting. |
| DPDP / portability | — | No telemetry of personal data; encrypted JSON + PDF export must fully reconstruct state offline. |

**Background-scheduling reality:** the app isn't a daemon. Reminders are **computed when the app
opens** and (when running) raised as OS notifications. We do not get reliable background firing while
closed — documented as a known limitation, not a bug.

---

## Shared data model (the backbone)

The spec's suggested entities don't exist yet — today everything hangs off the flat `accounts`
table. Most features need three new tables first; they are the critical path.

```
people          -- family / executor / nominee / doctor / RM, with relationship + access tier
holdings        -- links accounts <-> people with a role (nominee / co-holder / beneficiary) + share %
documents       -- typed (Will, PoA, AMD, PolicyDoc, Statement, IDCard, …): file ref + metadata
reminders       -- typed, scheduled, optional account/document/person link
life_events     -- typed; spawns a review checklist
access_grants   -- person <-> scope <-> tier <-> trigger (local-only semantics)
audit_log       -- every reveal of Tier-2 data
health_profile  -- 1 row (blood group, allergies, conditions, meds)
```

Storage decisions:
- **Documents:** binary lives under `$APPDATA/documents/<uuid>` (granted in `capabilities`), metadata
  in SQLite. **Encrypted at rest** (owner decision). Mechanism: a random 256-bit document encryption
  key (DEK) is generated once and stored **inside Stronghold** (alongside credentials, so it's already
  protected by the master-password-derived snapshot key). On attach, the DEK is read from the unlocked
  vault and the blob is sealed with **WebCrypto AES-256-GCM** before `writeFile`; on preview it's read
  back and decrypted in memory. Net effect: document files on disk are unreadable without an unlocked
  vault, and attach/preview **require the vault to be unlocked** (UI gates on `vault.store`, same as
  credentials). Keeps SQLite small; the encrypted export stays portable.
- **Secrets (seed phrases, recovery codes):** stay in **Stronghold**, never SQLite — extend the
  existing `vault_entries` pattern.
- **Migrations** continue the `src-tauri/migrations/000N_*.sql` + `lib.rs` registration convention
  (next free version is **9**).

---

## Phase 0 — Emergency action & contact ✅ DONE

Shipped: `accounts.contact` + `accounts.emergency_action` (migration 0008), AccountForm fields with
the "add a contact" nudge, Excel column auto-detection (`contact` / `what to do` / `emergency` /
`action`), the **Press during Emergency** dialog (click-to-call/email + disclaimer), and the
**Emergencies** page. Covers a thin slice of Features 1, 8, 9. All work below builds on this.

---

## Phase 1 — Foundation: People + Documents ✅ DONE

Shipped: migration 0009 (`people`, `documents`); `db/people.ts` + `db/documents.ts`; vault document
DEK in Stronghold + `docCrypto.ts` (AES-256-GCM) + `documentFiles.ts` (encrypted `$APPDATA/documents`
blobs); `relationship` finite-set master; **People** page (CRUD + Excel/CSV import) with route + nav;
reusable vault-gated `<DocumentAttach>` wired into AccountDetail; FS capability scopes. Tests:
docCrypto round-trip + people-import mapping (full suite 103 passing). **Deferred to Phase 5:**
nominee/co-holder *column* import (needs the `holdings` table).

**Unblocks:** F2, F3, F4, F5, F8, F9, F11. Nothing prioritized can land cleanly without People, and
Health/Insurance/Will need Documents. This is the dependency tax — kept as small as possible.

- **Migration 0009:** `people` (id, name, relationship, phone, email, id_proof_ref, access_tier
  default 0, notes) and `documents` (id, type, title, file_path, account_id?, person_id?, issued_on,
  expires_on, location_of_original, version, notes).
- **DB:** `db/people.ts`, `db/documents.ts` (typed wrappers, same style as `accounts.ts`).
- **Vault/FS:** document blob read/write under `$APPDATA/documents/` + optional encryption helper in
  `src/vault/`; add the FS path scope to `capabilities/default.json`.
- **UI:** a **People** page (CRUD, reuse `FiniteSetInput` for relationship), and a reusable
  `<DocumentAttach>` component (pick file → save → list/preview/delete) usable from any record.
- **Excel:** importer recognises a People sheet and `nominee`/`co-holder` columns (extends the
  Phase-0 header-detection approach).
- **Acceptance:** add a person in ≤60s; attach a document to an account; both survive a relock.

---

## Phase 2 — Reminders engine (Priority #1, Feature 12 + scheduling for 10) ✅ DONE

Shipped: migration 0010 (`reminders`); pure `domain/reminders.ts` (buckets, day math, annual
recurrence, FY-review date) with 12 tests; `db/reminders.ts` CRUD + idempotent `syncDerivedReminders`
(FD maturity from `accounts.maturity_date`, document expiry from `documents.expires_on`); OS
notifications via `tauri-plugin-notification` behind a graceful `lib/notify.ts`; `runReminderSweep`
on app open; **Reminders** inbox page (Overdue / Due soon / Upcoming / Snoozed; done/snooze/dismiss/
edit/delete) with route + nav. Full suite 115 passing. **Needs a `tauri:dev` rebuild** to compile the
new Rust plugin. **Note:** document-expiry reminders only fire once a later phase captures
`expires_on` (insurance/Will); FD-maturity reminders work today.

### Original plan

- **Migration 0010:** `reminders` (id, type, title, due_date, cadence, account_id?, document_id?,
  person_id?, status, snoozed_until, last_fired_at).
- **Domain:** `domain/reminders.ts` — pure scheduling: next-due computation, recurrence (annual /
  N-days-before), FY-anchored review dates from `fy_start_month`. No LLM, fully testable.
- **Auto-sources:** seed reminders from existing data — **FD maturity** (`accounts.maturity_date`,
  already present), and later policy renewals (Phase 4) and nominee reviews (Phase 5, >3yr stale).
- **Delivery:** `tauri-plugin-notification` for OS notifications when running + an in-app
  **Reminders** inbox (due / upcoming / snoozed). Email/push/SMS explicitly marked "needs backend —
  out of scope" in the UI.
- **Acceptance:** an FD maturing next month shows in the inbox and fires an OS notification on open;
  reminders are snoozable and recur correctly across a FY boundary.

---

## Phase 3 — Hospitalisation-Ready Health / ICE file (Priority #2, Feature 8)

- **Migration 0011:** `health_profile` (single row: blood_group, allergies, chronic_conditions,
  medications JSON). Doctors = `people` rows tagged relationship "doctor"; ID/insurance cards =
  `documents` typed `IDCard`/`HealthCard`.
- **UI:** **Health file** page — profile editor, doctor list (from People), card images (from
  Documents), emergency contacts (Tier-0 people), Advance-Directive quick-link (Phase 7).
- **ICE export:** printable wallet-size card + phone-wallpaper image (render to canvas/PDF, save via
  the existing Tauri dialog/FS path). Pulls cashless-hospital list once Insurance (Phase 4) exists.
- **Disclaimer:** reuse `EMERGENCY_DISCLAIMER`; add a medical "not a substitute for professional
  care" line.
- **Acceptance:** generate an ICE card offline showing blood group, allergies, one emergency contact,
  and policy number; viewable without unlocking the vault (Tier-0).

---

## Phase 4 — Insurance Coverage Dashboard (Priority #3, Feature 5)

- **Migration 0012:** insurance fields — either extend `accounts` (when `type='insurance'`) or a
  side `insurance_policies` table (policy_no, insurer, tpa, kind term/health/PA/CI/loan, sum_assured,
  premium, renewal_date, network_hospitals, claims_contact_person_id). Side table is cleaner; decide
  at build time.
- **Domain:** `domain/insurance.ts` — deterministic adequacy calculators: term = 10–15× annual income
  (configurable), health floater + top-up gap, PA disability check, CI threshold, loan-protection vs
  outstanding (reads loan accounts). Pure, testable.
- **Reminders:** renewal reminders at 30/15/5 days (via Phase 2).
- **UI:** **Insurance** page — coverage gauges, renewal calendar, cashless-hospital list, claims
  directory (People).
- **Excel:** policy import columns (insurer, sum assured, renewal).
- **Acceptance:** entering income + policies yields a term/health/PA gap readout; a renewal 20 days
  out appears in the Reminders inbox.

---

## Phase 5 — Nominee & Beneficiary Tracker (Priority #4, Feature 2)

- **Migration 0013:** `holdings` (account_id, person_id, role nominee/co-holder/beneficiary, share_pct,
  order, sec39_beneficial flag). Add `accounts.holding_mode` (single / joint / either-or-survivor /
  former-or-survivor).
- **Domain:** `domain/nominations.ts` — share-sum validation (=100%), "assets without nominees",
  "nominees by person" exposure rollup, stale (>3yr) detection.
- **UI:** per-account nominee editor (link People + share); **Nominees** dashboard with the red-flag
  views.
- **Reminders:** "no nominee" / "stale nominee" reminders (Phase 2).
- **Excel:** nominee columns (name, relationship, share) auto-detected on import.
- **Acceptance:** flag every account missing a nominee; show total exposure per beneficiary; warn when
  shares don't sum to 100%.

---

## Phase 6 — Will & Legal Document Vault (Feature 3)

- Uses `documents` (type `Will`/`Codicil`/`ProbateOrder`) + `people` (executor, guardian, witnesses).
- **Migration 0014:** `will_meta` (executor_ids, guardian_id, witness_ids, registration details,
  location_of_original, probate_required flag for Mumbai/Kolkata/Chennai OCJ).
- **Reconciliation:** **Will-vs-nominee report** (needs Phase 5) — flags where the Will beneficiary ≠
  registered nominee. High real-world value.
- **Template builder:** deterministic simple-Will template with a prominent "complex estates need a
  lawyer" disclaimer. No LLM.
- **Acceptance:** upload + version a Will; generate the mismatch report; review-reminder on life events.

---

## Phase 7 — Power of Attorney & Incapacity Planning (Feature 4)

- `documents` typed `PoA`/`AMD`; **Migration 0015:** `poa_meta` (kind general/specific, registered,
  scope, attorney_in_fact person_id, covered account_ids, validity, revocation_status) and AMD fields
  (treatment preferences, organ donation, JM/notary attestation, distribution list).
- **Guidance content** (static, India): PoA limits on mental incapacity + MHA-2017 guardianship route.
- **Acceptance:** tag a PoA to the accounts it covers; capture an AMD with attestation tracking and a
  distribute-to-doctors list (People).

---

## Phase 8 — Joint Holdings & Liquidity Tracker (Feature 6)

- Reuses `accounts.holding_mode` (Phase 5). **Migration 0016:** household monthly-expense setting for
  the emergency-fund target.
- **Domain:** `domain/liquidity.ts` — "spouse-operable accounts" total (survivor-accessible without
  paperwork), emergency-fund tracker (6–12× expenses in liquid + joint instruments), low-liquidity
  alert (via Phase 2).
- **Acceptance:** dashboard tile showing survivor-accessible liquidity and an alert when it drops
  below the threshold.

---

## Phase 9 — Trusted Contacts & Progressive Access (Feature 9)

- **Migration 0017:** `access_grants` (person_id, scope, tier, trigger) + `audit_log` (timestamp,
  actor, scope, action).
- **Local semantics (constraint-bounded):** Tier 0 always-visible (ICE/health), Tier 1 = summary,
  Tier 2 = full register + vault keys. Triggers reduced to **manual unlock + local "last check-in"
  staleness flag**. Tier-2 reveal → **encrypted offline export package** (JSON+PDF) the contact opens
  on their device; every reveal writes to `audit_log`.
- **Acceptance:** produce a tier-scoped encrypted package; audit log lists every Tier-2 reveal.

---

## Phase 10 — Annual Review & Life-Event Engine (Feature 10)

- **Migration 0018:** `life_events` (type, date, notes). Built on Phase 2 reminders.
- **Engine:** `domain/review.ts` — annual checklist (register refresh, nomination verify, Will check,
  insurance gap, vault rotation) anchored to `fy_start_month`; each life event (marriage, childbirth,
  property, job change, loan, relocation, bereavement) generates a tailored checklist linking the
  relevant feature pages.
- **Acceptance:** flagging "property purchase" spawns a checklist touching register + nominee + Will +
  insurance; annual review fires on schedule.

---

## Phase 11 — Family Communication Pack (Feature 11)

- Generates a **"what-if" briefing** for one designated person: master-register location, executor,
  lawyer/CA contacts (People), key account list (numbers redacted/unredacted per user choice).
- **Print-to-PDF** with optional password (reuse the Tauri dialog/FS + encryption helpers).
- **"Family meeting" mode:** static guided agenda.
- **Acceptance:** one-click password-protected briefing PDF that fully reconstructs "who/what/where".

---

## Phase 12 — Master Asset Register completion (Feature 1) + cross-cutting NFRs

- Finishes F1: co-holders (via `holdings`), last-verified date, free-text notes already partly there;
  **full register PDF + encrypted-JSON export/import**, global search/filter across all assets.
- **Cross-cutting:** confirm client-side encryption for vault + document blobs; scheduled encrypted
  backup restorable on a fresh install; Tier-2 audit visibility; DPDP-aligned (no off-device personal
  data). Portability test: wipe + restore from export reproduces everything.
- **Acceptance:** add an asset in ≤60s; export the whole register as PDF and encrypted JSON; reinstall
  + restore = identical state.

---

## Sequencing summary & dependencies

```
Phase 0 ✅
   └─ Phase 1 (People + Documents)  ← critical path, unblocks the rest
         ├─ Phase 2 Reminders        (Priority #1)
         ├─ Phase 3 Health/ICE       (Priority #2; uses People, Documents; pulls cashless from P4)
         ├─ Phase 4 Insurance        (Priority #3; uses Reminders P2, People)
         ├─ Phase 5 Nominees         (Priority #4; uses People)
         ├─ Phase 6 Will             (needs P5 for reconciliation)
         ├─ Phase 7 PoA / AMD        (uses Documents, People)
         ├─ Phase 8 Liquidity        (uses holding_mode from P5)
         ├─ Phase 9 Access tiers     (uses People; export/encrypt helpers)
         ├─ Phase 10 Review engine   (uses Reminders P2)
         └─ Phase 11 Family pack     (uses People, Documents, export)
   └─ Phase 12 Register + NFRs (finalisation)
```

Each phase is independently shippable, ends with a migration + tests + a disclaimer pass, and reuses
the Excel-import and emergency-disclaimer patterns established in Phase 0.

## Product decisions — all RESOLVED

1. **Documents (Phase 1):** **Encrypt at rest.** Random 256-bit DEK in Stronghold, WebCrypto
   AES-256-GCM seals blobs; attach/preview require an unlocked vault.
2. **Notifications (Phase 2):** **OS-local + in-app inbox.** Add `tauri-plugin-notification`; OS
   notifications while running plus an in-app inbox. Email/SMS/push are out of scope (need a backend).
3. **Insurance (Phase 4):** **Dedicated `insurance_policies` table**, linkable to an account — no
   null-column bloat on `accounts`.
4. **Will (Phase 6):** **Built-in deterministic simple-Will template** (no LLM) with a "complex estates
   need a lawyer" disclaimer, plus storage of uploaded Wills.
5. **Access tiers (Phase 9):** **Encrypted offline package.** Tier-2 reveal = encrypted JSON+PDF a
   contact opens on their device; triggers = manual unlock + local "last check-in" staleness flag;
   audit-logged. No backend.
