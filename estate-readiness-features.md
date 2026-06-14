# Estate Readiness & Family Asset Access — Feature Spec

## Context

A personal/family planning app that helps users prepare proactively so their family can access assets and make decisions without friction in the event of death, coma, ICU hospitalisation, or long-term disability.

Primary jurisdiction: **India** (nominations, Hindu Succession Act / Indian Succession Act, probate in Bombay HC jurisdiction, Advance Medical Directives per Common Cause judgment, Section 39 Insurance Act, Mental Healthcare Act 2017). Core domain model is general and can be extended to other jurisdictions.

## Design principles

- **Single source of truth.** One register, multiple lenses (by asset / by person / by document / by reminder).
- **Graceful incapacity.** Trusted contacts get progressive access tiers — visibility while user is well, full access after verified triggering event.
- **Offline-survivable.** Everything must be retrievable without the app (encrypted PDF export, print-ready "sealed envelope" view).
- **Periodic nudge.** App prompts annual review and after life events (marriage, childbirth, property purchase, job change, new loan).
- **Privacy-first.** End-to-end encryption for sensitive data; user controls all sharing.

---

## Feature 1: Master Asset Register

Central inventory of all financially or legally relevant holdings.

**Asset categories**
- Bank accounts (savings, current, FD, RD, sweep)
- Demat accounts and holdings
- Mutual funds (folios across AMCs)
- Retirement / govt schemes (EPF, NPS, PPF, Sukanya Samriddhi, gratuity, APY)
- Insurance policies (term, endowment, ULIP, health, motor, home, accident, critical illness, loan protection)
- Real estate and immovable property
- Lockers (bank, private)
- Vehicles
- Business interests, partnerships, private equity, startup ESOPs/RSUs
- Crypto and digital assets (with custody type: exchange / self-custody / hardware)
- Receivables (money lent, deposits paid)
- Loans and liabilities (outstanding principal, EMI, lender, loan account, co-borrower)

**Per-asset fields**
- Institution, account/policy/folio number, holding mode (single / joint / either-or-survivor)
- Co-holders with order
- Nominee(s) with percentage share
- Current value (manual entry; optional integration for live data)
- Document attachments (statements, certificates)
- Branch/RM contact
- Last-verified date
- Free-text notes

**Acceptance**
- Add an asset in ≤ 60 seconds
- CSV / JSON bulk import
- Export full register as PDF and as encrypted JSON
- Search and filter across all assets

---

## Feature 2: Nominee & Beneficiary Tracker

Critical India-specific feature: nominees are custodians, not owners — gaps cause real disputes.

- Per-asset nominee record with name, relationship, percentage, contact, ID proof reference
- Dashboard view: "Assets without nominees" (red flag)
- Dashboard view: "Nominees by person" — see total exposure per beneficiary
- Flag mismatches between nominees and Will beneficiaries
- Reminder when an asset has no nominee or stale (> 3 yr) nominee record
- Tag insurance policies where nominee is a "beneficial nominee" under Sec 39 (parent/spouse/child) vs ordinary nominee

---

## Feature 3: Will & Legal Document Vault

- Upload and version Will, codicils, registration receipts, probate orders
- Capture: executor(s), guardian for minors, witnesses, registration details, location of physical original
- Will-vs-nominee reconciliation report
- Template builder for a simple Will (with disclaimer that complex estates need a lawyer)
- Reminder: review Will after every life event flagged in the system
- Probate-required flag for Mumbai/Kolkata/Chennai OCJ jurisdiction holdings

---

## Feature 4: Power of Attorney & Incapacity Planning

- Store and tag PoA documents (general / specific, registered or not, scope, attorney-in-fact)
- Track validity, revocation status, and which assets each PoA covers
- Living Will / Advance Medical Directive module:
  - Capture treatment preferences (life support, resuscitation, organ donation)
  - Witness and Judicial Magistrate / notary attestation tracking
  - Distribute copies to listed doctors and family
- Guidance content explaining India's PoA limitations on mental incapacity and the guardianship route under MHA 2017

---

## Feature 5: Insurance Coverage Dashboard

- Coverage adequacy calculator:
  - Term life: target = 10–15× annual income, customisable
  - Health: family floater + top-up gap analysis vs. typical metro hospitalisation costs
  - Personal accident: permanent + temporary disability cover check
  - Critical illness: lump-sum cover vs. recommended threshold
  - Loan protection: outstanding loans vs. covered amount
- Renewal calendar with reminders 30 / 15 / 5 days before due
- Cashless hospital list per policy (network)
- Claims contact directory (insurer, TPA, branch)

---

## Feature 6: Joint Holdings & Liquidity Tracker

- Mark each account's operation mode (single / either-or-survivor / former-or-survivor / jointly)
- "Spouse-operable accounts" view: total liquidity accessible by surviving partner without paperwork
- Emergency fund tracker: target = 6–12 months of household expenses in liquid + joint-mode instruments
- Alert when emergency liquidity drops below threshold

---

## Feature 7: Digital Access Vault

- Encrypted credential store integrated with (or replacing) a password manager workflow
- Categories: email, banking, broker, UPI, crypto wallets (with seed-phrase storage), cloud, domains, DigiLocker, social media
- "Master access" recovery package: master password + recovery codes sealed for designated trusted contact
- Crypto-specific: distinguish exchange accounts (need login) from self-custody (need seed phrase + passphrase)
- 2FA backup codes capture per service

---

## Feature 8: Hospitalisation-Ready Health File

A grab-and-go medical file accessible offline and shareable in seconds.

- ID and insurance card images (Aadhaar, PAN, health card, policy number)
- Blood group, allergies, chronic conditions, current medications + dosages
- Doctor and specialist contacts
- Cashless hospital list (pulled from insurance module)
- Emergency contacts with relationship and access tier
- Advance Medical Directive quick-link
- ICE (In Case of Emergency) lock-screen card export — printable wallet-size + phone wallpaper

---

## Feature 9: Trusted Contacts & Progressive Access

Tiered access for family members and the executor.

- Tier 0 (always visible): emergency contacts, ICE card, hospitalisation file
- Tier 1 (visible while user well): asset summary without sensitive numbers
- Tier 2 (triggered): full register, Will location, vault keys
- Triggers: user's manual unlock, dead-man's switch (no check-in for N days), or attestation by multiple trusted contacts (M-of-N)
- Audit log of all access events

---

## Feature 10: Annual Review & Life-Event Engine

- Yearly scheduled review covering: asset register refresh, nomination verification, Will check, insurance gap analysis, vault rotation
- Life-event triggers (user-flagged or detected): marriage, childbirth, property purchase, job change, new loan, relocation, parent's death
- Each event generates a custom review checklist with relevant feature touchpoints

---

## Feature 11: Family Communication Pack

- Generate a "what if" briefing document for one designated family member: location of master register, executor name, lawyer/CA contacts, key account list (numbers redacted or unredacted per user choice)
- Print-to-PDF with optional password
- "Family meeting" mode: guided agenda for the once-a-year conversation

---

## Feature 12: Reminders & Notification System

- Per-asset reminders (FD maturity, policy renewal, nominee review, KYC update)
- Will/PoA review on a cadence
- Life-event prompts after long gaps in usage
- Channel options: in-app, email, push, optional SMS for high-priority

---

## Data model (suggested high-level entities)

```
User
Person (family / executor / nominee / doctor — with relationships and access tier)
Asset (polymorphic: BankAccount, Demat, MutualFund, Policy, Property, Vehicle, Business, Crypto, Loan, …)
Holding (links Asset ↔ Person with role: holder / nominee / co-holder / beneficiary)
Document (typed: Will, PoA, AMD, PolicyDoc, Statement, …; encrypted blob + metadata)
CredentialEntry (vault item linked optionally to an Asset)
Reminder (typed, scheduled, optional asset/document link)
LifeEvent (typed; triggers review playbook)
AccessGrant (Person ↔ scope ↔ tier ↔ trigger condition)
AuditLog
```

---

## Non-functional requirements

- **Encryption:** client-side encryption for vault and sensitive document blobs; user's master key never leaves device unencrypted.
- **Backup:** encrypted export (JSON + PDF) on demand and on schedule, restorable on a fresh install.
- **Portability:** no lock-in — export must include everything needed to reconstruct outside the app.
- **Audit:** every access to Tier 2 data is logged and visible to the user.
- **Compliance considerations:** DPDP Act (India), data residency preferences for Indian users.

---

## Out of scope (initial version)

- Direct integration with bank / broker / AMC APIs (manual entry first)
- Automated claim filing
- Tax filing
- Multi-jurisdiction succession rules beyond India

---

## Open questions for product decisions

1. Hosted vs. local-first (Tauri-style local DB + optional sync)?
2. Pricing model — flat annual, or freemium with vault as paid tier?
3. Notary / lawyer marketplace integration in v1 or later?
4. How much of the Will-drafting flow to automate vs. partner with a legal service?
