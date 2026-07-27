import type { SchemaDescriptor, FieldDescriptor, Confidentiality } from "sharedcorelib/schema";

/**
 * K1 consolidation — SchemaDescriptors for EVERY table that used to live in the
 * per-app `myfinance.db` (retired). The suite now runs ONE shared `suite.db`
 * (CONTRACT §8); these descriptors register myFinance's namespaced tables
 * (`myfinance_*` via dbAlias) into the shared schema registry at boot.
 *
 * Fidelity note: descriptor-generated DDL is intentionally minimal (no CHECKs,
 * DEFAULTs, AUTOINCREMENT or FK clauses). The aux-SQL step v1 (`auxSql.ts`,
 * applied via `registerAuxMigrations`, CONTRACT §8.6) rebuilds each table with
 * the full legacy DDL — constraints, defaults, integer rowid keys, foreign keys —
 * immediately after first registration, and step v2 re-creates the 0021/0022 sync
 * trigger suite against the namespaced names. Descriptors stay the semantic
 * catalogue (confidentiality / DPDP personalData / purpose) that governs
 * cross-app reads and the backup engine.
 *
 * Confidentiality audit: nothing password/token-like lives in SQLite — credentials
 * are in the Stronghold vault; `vault_entries.stronghold_key` is a record POINTER
 * (Restricted), not a secret. Hence no `Secret`-tier fields here.
 *
 * `HealthProfile` ADOPTS the common ICE card (`common#IceCard`) instead of keeping
 * the legacy single-row `health_profile` copy — invariant 6 (spine/common data is
 * read/written via core, never re-modeled per app). See `db/health.ts`.
 */

type F = Partial<FieldDescriptor> & Pick<FieldDescriptor, "name" | "dataType">;
const fields = (fs: F[]): FieldDescriptor[] => fs as FieldDescriptor[];

const table = (
  name: string,
  dbAlias: string,
  confidentiality: Confidentiality,
  purpose: string,
  fs: F[],
  extra: Partial<SchemaDescriptor> = {},
): SchemaDescriptor => ({
  namespace: "myfinance",
  name,
  dbAlias,
  schemaType: "Table",
  confidentiality,
  owner: "myfinance",
  purpose,
  fields: fields(fs),
  ...extra,
});

const id: F = { name: "id", dataType: "id", keyField: true, editability: "Generated", description: "integer rowid key (preserved from the legacy DB)" };
const syncId: F = { name: "sync_id", dataType: "id", index: "Unique", description: "stable cross-device identity for LAN sync (0021)" };
const createdAt: F = { name: "created_at", dataType: "date", description: "creation timestamp" };
const updatedAt: F = { name: "updated_at", dataType: "date", description: "last-write timestamp (LWW sync clock)" };

export const MYFINANCE_LEGACY_SCHEMAS: SchemaDescriptor[] = [
  table("Settings", "myfinance_settings", "Confidential",
    "App preferences + small state (currency, FY start, residence, estate check-in, patron grants, device id).", [
      { name: "key", dataType: "string", keyField: true, description: "setting key" },
      { name: "value", dataType: "string", required: true, personalData: true, confidentiality: "Confidential", purpose: "App preferences include residence and estate check-in state.", description: "setting value (stringified)" },
    ]),

  table("VaultEntries", "myfinance_vault_entries", "Restricted",
    "Friendly labels + Stronghold record pointers for stored credentials (ciphertext lives in the per-app Stronghold vault, never here).", [
      id,
      { name: "label", dataType: "string", required: true, description: "user-facing credential label" },
      { name: "stronghold_key", dataType: "string", required: true, index: "Unique", description: "Stronghold record key (pointer, not a secret)" },
      createdAt, syncId, updatedAt,
    ]),

  table("Accounts", "myfinance_accounts", "Confidential",
    "Financial accounts the user tracks net worth across (banks, deposits, investments, loans).", [
      id,
      { name: "name", dataType: "string", required: true, description: "account label" },
      { name: "type", dataType: "enum", required: true, description: "account type", constraints: { enumValues: [
        "bank_savings", "checking", "cash", "fixed_deposit", "recurring_deposit",
        "ppf", "epf", "nps", "stocks", "mutual_funds", "etf", "bonds", "pms_aif",
        "gold", "real_estate", "crypto", "loan", "credit_card", "insurance", "tax_refund", "other",
        "loan_given", "art_collectible", "vehicle"] } },
      { name: "institution", dataType: "string", description: "bank/AMC/issuer name" },
      { name: "currency", dataType: "string", description: "ISO currency code" },
      { name: "opening_balance", dataType: "number", description: "opening balance" },
      { name: "credential_id", dataType: "id", description: "FK → myfinance_vault_entries.id" },
      { name: "is_archived", dataType: "boolean", description: "archived flag" },
      createdAt,
      { name: "type_note", dataType: "string", description: "free-text note for 'other' type" },
      { name: "maturity_date", dataType: "date", description: "term-product maturity (YYYY-MM-DD)" },
      { name: "contact", dataType: "string", personalData: true, purpose: "Emergency contact so family can act on this account.", description: "free-text emergency contact" },
      { name: "emergency_action", dataType: "string", personalData: true, purpose: "What family should do for this account in an emergency.", description: "free-text emergency action" },
      { name: "holding_mode", dataType: "string", description: "single / joint / either_or_survivor / former_or_survivor" },
      syncId, updatedAt,
      { name: "sip_day", dataType: "number", description: "SIP debit day-of-month (mutual funds)" },
      { name: "sip_amount", dataType: "number", description: "SIP installment amount" },
      { name: "sip_last_done", dataType: "date", description: "last SIP occurrence marked done (YYYY-MM-DD)" },
      { name: "customer_id", dataType: "string", personalData: true, purpose: "Bank customer/CIF ID — many banks build the statement PDF password from it, so it's remembered here instead of asked on every import.", description: "bank customer/CIF ID" },
      { name: "is_family", dataType: "boolean", description: "marks the account as belonging to a family member rather than the primary user — grouped separately on the Dashboard regardless of its type category" },
      { name: "family_relation", dataType: "enum", description: "minor | adult — only meaningful when is_family is set; a minor's account income can be clubbed into the primary filer's tax return (Sec 64(1A)), an adult's never is", constraints: { enumValues: ["minor", "adult"] } },
    ]),

  table("Transactions", "myfinance_transactions", "Confidential",
    "Per-transaction rows parsed from a bank/credit-card statement import, one per account (desktop-only feature). Self-transfer match state is device-local — never synced (see auxSql.ts/sync/spec.ts). Categorization now lives on TransactionTags (a transaction can carry multiple tags) — the category/category_source columns below are LEGACY: left physically in place (never dropped from a populated user table) but no longer read or written by any app code.", [
      id,
      { name: "account_id", dataType: "id", required: true, description: "FK → myfinance_accounts.id (ON DELETE CASCADE)" },
      { name: "date", dataType: "date", description: "YYYY-MM-DD, null if the statement's date string couldn't be parsed" },
      { name: "raw_date", dataType: "string", description: "the date exactly as printed on the statement" },
      { name: "description", dataType: "string", personalData: true, purpose: "Bank narration text, kept to build the per-account transaction ledger and suggest tags.", description: "transaction narration" },
      { name: "debit", dataType: "number", description: "amount out, or null" },
      { name: "credit", dataType: "number", description: "amount in, or null" },
      { name: "balance", dataType: "number", description: "running balance after this row, or null" },
      { name: "category", dataType: "string", description: "LEGACY, unused — superseded by TransactionTags" },
      { name: "category_source", dataType: "enum", description: "LEGACY, unused — superseded by TransactionTags", constraints: { enumValues: ["auto", "manual"] } },
      { name: "matched_transaction_id", dataType: "id", description: "self-FK → another myfinance_transactions.id (self-transfer counterpart); device-local, not synced" },
      { name: "match_status", dataType: "enum", description: "none | suggested | confirmed | dismissed", constraints: { enumValues: ["none", "suggested", "confirmed", "dismissed"] } },
      { name: "source_path", dataType: "string", description: "e.g. 'STATEMENT:<filename>' — which import wrote this row" },
      createdAt, syncId, updatedAt,
    ]),

  table("TransactionTags", "myfinance_transaction_tags", "Confidential",
    "Per-transaction category tags (a transaction can carry more than one — e.g. a UPI grocery payment tagged both 'upi_payment' and 'groceries'). Replaces the old single category/category_source columns on Transactions (left physically in place, no longer read/written, see auxSql.ts).", [
      id,
      { name: "transaction_id", dataType: "id", required: true, description: "FK → myfinance_transactions.id (ON DELETE CASCADE)" },
      { name: "category", dataType: "string", required: true, description: "transaction_category master value" },
      { name: "source", dataType: "enum", required: true, description: "auto | manual", constraints: { enumValues: ["auto", "manual"] } },
      createdAt, syncId, updatedAt,
    ]),

  table("CategoryRules", "myfinance_category_rules", "Confidential",
    "Learned narration→category mappings taught by the user's own manual tagging — kept independently of the transaction rows that taught them, so a merchant/payee once tagged auto-tags identically on every future import even after those rows are deleted or the statement is re-imported (see domain/transactionCategory.ts's suggestCategoryTagsWithRules and db/categoryRules.ts). One pattern can teach multiple categories (e.g. a UPI narration pattern learned as both 'upi_payment' and 'groceries').", [
      id,
      { name: "pattern", dataType: "string", required: true, personalData: true, purpose: "Digit-collapsed bank narration fragment the user has classified before, kept to auto-classify future imports of the same recurring merchant/payee.", description: "normalize()'d narration key (see transactionCategory.ts)" },
      { name: "category", dataType: "string", required: true, description: "transaction_category master value this pattern maps to" },
      { name: "hit_count", dataType: "number", description: "number of times this (pattern, category) pair has been (re)taught — informational only" },
      createdAt, updatedAt,
    ]),

  table("MonthlySnapshots", "myfinance_monthly_snapshot", "Confidential",
    "One balance per (account, month) — the net-worth time series.", [
      id,
      { name: "account_id", dataType: "id", required: true, description: "FK → myfinance_accounts.id (ON DELETE CASCADE)" },
      { name: "month", dataType: "string", required: true, description: "YYYY-MM", constraints: { pattern: "^\\d{4}-\\d{2}$" } },
      { name: "value", dataType: "number", required: true, description: "balance for that month" },
      { name: "note", dataType: "string", description: "optional note" },
      { name: "source", dataType: "enum", description: "manual | import", constraints: { enumValues: ["manual", "import"] } },
      updatedAt,
    ]),

  table("Goals", "myfinance_goals", "Confidential",
    "Savings goals with target amount/date and ETA projection.", [
      id,
      { name: "name", dataType: "string", required: true, description: "goal label" },
      { name: "target_amount", dataType: "number", required: true, description: "target corpus" },
      { name: "target_date", dataType: "date", description: "target date (optional)" },
      { name: "baseline_month", dataType: "string", description: "YYYY-MM the goal counts from" },
      { name: "account_filter", dataType: "string", description: "JSON list of account ids contributing" },
      createdAt,
      { name: "archived_at", dataType: "date", description: "soft-archive timestamp" },
      { name: "category", dataType: "string", description: "life-goal template category" },
      syncId, updatedAt,
    ]),

  table("TaxYears", "myfinance_tax_years", "Confidential",
    "One row per assessment year: chosen ITR form and import metadata.", [
      { name: "ay", dataType: "string", keyField: true, description: "assessment year, e.g. 'AY2026-27'" },
      { name: "itr_form", dataType: "string", description: "'1'..'4' or null" },
      { name: "itr_form_source", dataType: "string", description: "manual | import | wizard" },
      { name: "imported_filename", dataType: "string", description: "source ITR JSON file name" },
      { name: "notes", dataType: "string", description: "free-text notes" },
      createdAt, updatedAt,
    ]),

  table("TaxIncome", "myfinance_tax_income", "Confidential",
    "Income line items per assessment year (salary, house property, capital gains, …).", [
      id,
      { name: "ay", dataType: "string", required: true, description: "FK → myfinance_tax_years.ay" },
      { name: "head", dataType: "string", required: true, description: "income head" },
      { name: "label", dataType: "string", required: true, description: "line-item label" },
      { name: "amount", dataType: "number", required: true, personalData: true, purpose: "The user's income detail, kept to compute and review tax.", description: "amount" },
      { name: "source_path", dataType: "string", description: "JSON path when imported" },
      { name: "note", dataType: "string", description: "note" },
      { name: "excluded", dataType: "boolean", description: "set by the reconciliation screen when this row is confirmed to duplicate another source document's row — excluded from totals, not deleted" },
      syncId, updatedAt,
    ]),

  table("TaxDeductions", "myfinance_tax_deductions", "Confidential",
    "Deduction line items per assessment year (80C, 80D, …).", [
      id,
      { name: "ay", dataType: "string", required: true, description: "FK → myfinance_tax_years.ay" },
      { name: "section", dataType: "string", required: true, description: "deduction section" },
      { name: "label", dataType: "string", required: true, description: "line-item label" },
      { name: "amount", dataType: "number", required: true, personalData: true, purpose: "The user's deduction detail, kept to compute and review tax.", description: "amount" },
      { name: "source_path", dataType: "string", description: "JSON path when imported" },
      { name: "note", dataType: "string", description: "note" },
      syncId, updatedAt,
    ]),

  table("TaxPayments", "myfinance_tax_payments", "Confidential",
    "Tax payments per assessment year (TDS, advance, self-assessment).", [
      id,
      { name: "ay", dataType: "string", required: true, description: "FK → myfinance_tax_years.ay" },
      { name: "type", dataType: "string", required: true, description: "tds_salary | tds_other | advance | self_assessment | tcs" },
      { name: "payer_name", dataType: "string", personalData: true, purpose: "Identify the deductor on a TDS entry.", description: "payer/deductor name" },
      { name: "amount", dataType: "number", required: true, personalData: true, purpose: "The user's tax-payment detail, kept to compute and review tax.", description: "amount" },
      { name: "source_path", dataType: "string", description: "JSON path when imported" },
      { name: "note", dataType: "string", description: "note" },
      { name: "excluded", dataType: "boolean", description: "set by the reconciliation screen when this row is confirmed to duplicate another source document's row — excluded from totals, not deleted" },
      syncId, updatedAt,
    ]),

  table("TaxAssessment", "myfinance_tax_assessment", "Confidential",
    "Computed assessment summary per assessment year.", [
      { name: "ay", dataType: "string", keyField: true, description: "FK → myfinance_tax_years.ay" },
      { name: "gross_total_income", dataType: "number", personalData: true, purpose: "The user's income summary, kept to compute and review tax.", description: "gross total income" },
      { name: "total_deductions", dataType: "number", description: "total deductions" },
      { name: "total_income", dataType: "number", description: "total income" },
      { name: "total_tax_payable", dataType: "number", description: "total tax payable" },
      { name: "rebate_87a", dataType: "number", description: "87A rebate" },
      { name: "education_cess", dataType: "number", description: "education cess" },
      { name: "net_tax_liability", dataType: "number", description: "net tax liability" },
      { name: "total_taxes_paid", dataType: "number", description: "total taxes paid" },
      { name: "refund_or_balance", dataType: "number", description: "refund (+) or balance due (−)" },
      updatedAt,
    ]),

  table("TaxWizardAnswers", "myfinance_tax_wizard_answers", "Confidential",
    "Per-AY answers to the ITR recommendation wizard.", [
      { name: "ay", dataType: "string", keyField: true, description: "FK → myfinance_tax_years.ay" },
      { name: "answers", dataType: "string", required: true, description: "JSON blob of wizard answers" },
      { name: "recommended", dataType: "string", description: "recommended ITR form" },
      { name: "rationale", dataType: "string", description: "recommendation rationale" },
      updatedAt,
    ]),

  table("AisSft", "myfinance_ais_sft", "Confidential",
    "SFT (Statement of Financial Transaction) rows read from the AIS Utility JSON — large-value transactions banks/registrars/AMCs report to the tax department, kept separately from income/TDS (which are sourced from tdsTcs, not sft, to avoid double-counting) so they can be cross-checked against the bank transaction ledger.", [
      id,
      { name: "ay", dataType: "string", required: true, description: "FK → myfinance_tax_years.ay" },
      { name: "sft_code", dataType: "string", description: "e.g. 'SFT-005'" },
      { name: "description", dataType: "string", personalData: true, purpose: "Identify the reported transaction category for the user's SFT cross-check.", description: "information description" },
      { name: "reporting_entity", dataType: "string", personalData: true, purpose: "Identify who reported this transaction (bank/registrar/AMC) for the user's SFT cross-check.", description: "reporting bank/registrar/AMC name" },
      { name: "amount", dataType: "number", required: true, personalData: true, purpose: "The user's reported transaction amount, kept to cross-check against bank data.", description: "amount" },
      { name: "date", dataType: "date", description: "usually null — SFT rows are typically FY-level aggregates" },
      syncId, updatedAt,
    ]),

  table("TaxRefunds", "myfinance_tax_refunds", "Confidential",
    "Refunds already issued, read from AIS/TIS PDF Part B4 (see tax/categoryAmountPdf.ts's extractRefundRows) — informational, not folded into tax_assessment's totals.", [
      id,
      { name: "ay", dataType: "string", required: true, description: "FK → myfinance_tax_years.ay" },
      { name: "amount", dataType: "number", required: true, personalData: true, purpose: "The user's refund amount, for their own tax-year review.", description: "refund amount" },
      { name: "mode", dataType: "string", description: "e.g. 'ECS'" },
      { name: "refund_date", dataType: "date", description: "date of payment" },
      { name: "source_path", dataType: "string", description: "which import produced this row, e.g. 'AIS-PDF'" },
      { name: "note", dataType: "string", personalData: true, purpose: "Nature-of-refund text from the source document.", description: "free-text note" },
      syncId, updatedAt,
    ]),

  table("TaxCaComputation", "myfinance_tax_ca_computation", "Confidential",
    "Line items read from the user's Chartered Accountant's own tax computation sheet (see tax/caComputation.ts) — a freeform label/amount table, kept entirely separate from tax_income/tax_deductions/tax_payments so it can serve as an independent check (tax/caReconciliation.ts) rather than feeding this app's own computed figures.", [
      id,
      { name: "ay", dataType: "string", required: true, description: "FK → myfinance_tax_years.ay" },
      { name: "label", dataType: "string", personalData: true, purpose: "The CA document's own line-item label, kept for the user's side-by-side reconciliation review.", required: true, description: "line-item label as written in the CA's document" },
      { name: "amount", dataType: "number", personalData: true, purpose: "The CA document's own figure for this line item, for the user's own reconciliation review — never transmitted anywhere.", required: true, description: "line-item amount" },
      { name: "source_path", dataType: "string", description: "which import produced this row, e.g. 'CACalc-PDF'" },
      { name: "note", dataType: "string", personalData: true, purpose: "Free-text note carried from the source document.", description: "free-text note" },
      syncId, updatedAt,
    ]),

  table("ReconLinks", "myfinance_recon_links", "Confidential",
    "General 'these two records represent/might represent the same real-world event' link (bank transaction <-> tax document row, or tax document row <-> tax document row across different source documents) — generalizes the self-transfer match pattern. Device-local by design: a_kind/a_id + b_kind/b_id is a polymorphic reference the single-pass sync merge engine can't safely remap across devices, same reasoning as transactions.matched_transaction_id; each device recomputes and reviews its own candidates.", [
      id,
      { name: "a_kind", dataType: "string", required: true, description: "'transaction'|'tax_income'|'tax_payment'|'ais_sft'|'tax_refund'" },
      { name: "a_id", dataType: "id", required: true, description: "local rowid into whichever table a_kind names" },
      { name: "b_kind", dataType: "string", required: true, description: "same vocabulary as a_kind" },
      { name: "b_id", dataType: "id", required: true, description: "local rowid into whichever table b_kind names" },
      { name: "status", dataType: "string", required: true, description: "'suggested'|'confirmed'|'dismissed'" },
      { name: "note", dataType: "string", description: "free-text note" },
      createdAt, updatedAt,
    ]),

  table("CustomOptions", "myfinance_custom_options", "Internal",
    "User-added 'Other' values for finite-set inputs (country/city/institution/…).", [
      id,
      { name: "category", dataType: "string", required: true, description: "master id" },
      { name: "value", dataType: "string", required: true, description: "canonical stored value" },
      { name: "label", dataType: "string", required: true, description: "display label" },
      { name: "parent", dataType: "string", description: "dependency key (e.g. city → country code)" },
      createdAt, updatedAt,
    ]),

  table("People", "myfinance_people", "Confidential",
    "THIN spine link, not an identity table (invariant 6, finding 2.1). Identity (name/relationship/phone/email) lives ONCE on common#Person; finance estate fields (access_tier/id_proof_ref/notes) live on myfinance#PersonFacet — both keyed by person_key. This table only maps myFinance's historical integer id (the relational key every estate table's FK joins on) to a person_key, so holdings/will_meta/incapacity_meta/insurance/access_grants references survive untouched.", [
      id,
      { name: "person_key", dataType: "id", required: true, index: "Unique", description: "shared person key on common#Person (same key as the myfinance#PersonFacet row)" },
      createdAt, syncId, updatedAt,
    ],
    {
      relationships: [
        {
          name: "person",
          relationshipType: "Many-One",
          relatedSchema: "common#Person",
          description: "the shared identity this app-local id points at",
        },
      ],
    }),

  table("Documents", "myfinance_documents", "Confidential",
    "Typed legal/financial document metadata (Will, PoA, policies, statements). Blobs live AES-GCM-sealed on disk, never here.", [
      id,
      { name: "type", dataType: "string", description: "document type (will/poa/policy/…)" },
      { name: "title", dataType: "string", required: true, personalData: true, purpose: "Identify the user's legal/financial document.", description: "document title" },
      { name: "file_name", dataType: "string", description: "sealed blob file name under documents/ (null = metadata-only)" },
      { name: "mime", dataType: "string", description: "MIME type" },
      { name: "size", dataType: "number", description: "blob size in bytes" },
      { name: "encrypted", dataType: "boolean", description: "1 when the on-disk blob is AES-GCM sealed" },
      { name: "account_id", dataType: "id", description: "FK → myfinance_accounts.id" },
      { name: "person_id", dataType: "id", description: "FK → myfinance_people.id" },
      { name: "issued_on", dataType: "date", description: "issue date" },
      { name: "expires_on", dataType: "date", description: "expiry date" },
      { name: "location_of_original", dataType: "string", confidentiality: "Restricted", personalData: true, purpose: "Tell family where the physical original is kept.", description: "where the physical original lives" },
      { name: "notes", dataType: "string", description: "notes" },
      createdAt, syncId, updatedAt,
    ]),

  table("Reminders", "myfinance_reminders", "Confidential",
    "Manual + derived reminders (FD maturity, document expiry, SIP due, reviews).", [
      id,
      { name: "type", dataType: "string", description: "category (fd_maturity/doc_expiry/custom/…)" },
      { name: "title", dataType: "string", required: true, description: "reminder title" },
      { name: "notes", dataType: "string", description: "notes" },
      { name: "due_date", dataType: "date", required: true, description: "due date (YYYY-MM-DD)" },
      { name: "cadence", dataType: "enum", description: "once | annual", constraints: { enumValues: ["once", "annual"] } },
      { name: "source", dataType: "enum", description: "manual | derived", constraints: { enumValues: ["manual", "derived"] } },
      { name: "dedupe_key", dataType: "string", index: "Unique", description: "stable identity for a derived reminder" },
      { name: "status", dataType: "enum", description: "open | done | dismissed", constraints: { enumValues: ["open", "done", "dismissed"] } },
      { name: "snoozed_until", dataType: "date", description: "hidden until this date" },
      { name: "last_fired_on", dataType: "date", description: "last OS-notification date" },
      { name: "account_id", dataType: "id", description: "FK → myfinance_accounts.id" },
      { name: "document_id", dataType: "id", description: "FK → myfinance_documents.id" },
      { name: "person_id", dataType: "id", description: "FK → myfinance_people.id" },
      createdAt, syncId, updatedAt,
    ]),

  table("InsurancePolicies", "myfinance_insurance_policies", "Confidential",
    "Insurance policies for coverage-gap analysis and claims readiness.", [
      id,
      { name: "account_id", dataType: "id", description: "FK → myfinance_accounts.id" },
      { name: "kind", dataType: "enum", description: "policy kind", constraints: { enumValues: ["term", "health", "accident", "critical_illness", "loan", "endowment", "ulip", "motor", "home", "other"] } },
      { name: "insurer", dataType: "string", required: true, description: "insurer name" },
      { name: "policy_no", dataType: "string", confidentiality: "Restricted", personalData: true, purpose: "Identify the policy in a claim.", description: "policy number" },
      { name: "sum_assured", dataType: "number", description: "sum assured" },
      { name: "premium", dataType: "number", description: "premium" },
      { name: "renewal_date", dataType: "date", description: "renewal date" },
      { name: "tpa", dataType: "string", description: "third-party administrator" },
      { name: "network_hospitals", dataType: "string", description: "network-hospital info" },
      { name: "claims_contact_person_id", dataType: "id", description: "FK → myfinance_people.id" },
      { name: "notes", dataType: "string", description: "notes" },
      createdAt, syncId, updatedAt,
    ]),

  table("Holdings", "myfinance_holdings", "Confidential",
    "Account↔person links: nominees, co-holders, Will beneficiaries (+ share).", [
      id,
      { name: "account_id", dataType: "id", required: true, description: "FK → myfinance_accounts.id" },
      { name: "person_id", dataType: "id", required: true, description: "FK → myfinance_people.id" },
      { name: "role", dataType: "enum", description: "nominee | co_holder | beneficiary", constraints: { enumValues: ["nominee", "co_holder", "beneficiary"] } },
      { name: "share_pct", dataType: "number", description: "nominee/beneficiary share %" },
      { name: "position", dataType: "number", description: "ordering position" },
      { name: "sec39_beneficial", dataType: "boolean", description: "Sec 39 beneficial-nominee flag" },
      createdAt, syncId, updatedAt,
    ]),

  table("WillMeta", "myfinance_will_meta", "Restricted",
    "Single-row Will metadata (executor, registration, original's location).", [
      id,
      { name: "has_will", dataType: "boolean", description: "user has a Will" },
      { name: "executor_person_id", dataType: "id", description: "FK → myfinance_people.id" },
      { name: "guardian_person_id", dataType: "id", description: "FK → myfinance_people.id" },
      { name: "registered", dataType: "boolean", description: "Will registered" },
      { name: "registration_details", dataType: "string", personalData: true, purpose: "Locate the registered Will for probate.", description: "registration details" },
      { name: "location_of_original", dataType: "string", personalData: true, purpose: "Tell the executor where the Will original is kept.", description: "where the original is kept" },
      { name: "probate_required", dataType: "boolean", description: "probate required" },
      { name: "notes", dataType: "string", description: "notes" },
      updatedAt,
    ]),

  table("IncapacityMeta", "myfinance_incapacity_meta", "Restricted",
    "Single-row PoA + Advance Medical Directive metadata.", [
      id,
      { name: "poa_attorney_person_id", dataType: "id", description: "FK → myfinance_people.id" },
      { name: "poa_kind", dataType: "string", description: "general | specific" },
      { name: "poa_scope", dataType: "string", description: "PoA scope" },
      { name: "poa_registered", dataType: "boolean", description: "PoA registered" },
      { name: "poa_revoked", dataType: "boolean", description: "PoA revoked" },
      { name: "amd_life_support", dataType: "string", personalData: true, purpose: "The user's advance medical directive on life support.", description: "AMD: life support" },
      { name: "amd_resuscitation", dataType: "string", personalData: true, purpose: "The user's advance medical directive on resuscitation.", description: "AMD: resuscitation" },
      { name: "amd_organ_donation", dataType: "boolean", description: "AMD: organ donation" },
      { name: "amd_attestation", dataType: "string", description: "AMD attestation details" },
      { name: "notes", dataType: "string", description: "notes" },
      updatedAt,
    ]),

  table("AccessGrants", "myfinance_access_grants", "Restricted",
    "Progressive-access grants per person (tier 0/1/2) for estate disclosure.", [
      id,
      { name: "person_id", dataType: "id", required: true, description: "FK → myfinance_people.id" },
      { name: "tier", dataType: "number", description: "granted tier (0/1/2)", constraints: { min: 0, max: 2 } },
      { name: "scope", dataType: "string", description: "optional scope note" },
      { name: "trigger", dataType: "string", description: "manual | staleness" },
      createdAt, syncId, updatedAt,
    ]),

  table("AuditLog", "myfinance_audit_log", "Internal",
    "Append-only local audit of estate-access actions (check-ins, exports).", [
      id,
      { name: "at", dataType: "date", description: "timestamp" },
      { name: "action", dataType: "string", required: true, description: "action key" },
      { name: "detail", dataType: "string", description: "detail" },
    ]),

  table("LifeEvents", "myfinance_life_events", "Confidential",
    "Life events (marriage, child, move) driving tailored review checklists.", [
      id,
      { name: "type", dataType: "string", required: true, personalData: true, purpose: "Tailor estate-review checklists to the user's life events.", description: "event type" },
      { name: "event_date", dataType: "date", description: "event date" },
      { name: "notes", dataType: "string", description: "notes" },
      createdAt, syncId, updatedAt,
    ]),

  table("AppLaunches", "myfinance_app_launches", "Internal",
    "Local-only usage telemetry: one row per app launch (drives on-device engagement tiers; never transmitted).", [
      id,
      { name: "launched_at", dataType: "date", description: "UTC launch timestamp" },
    ]),

  table("MasterOptions", "myfinance_master_options", "Public",
    "OTA-pushed reference data (countries, cities, institutions, …) — public master rows.", [
      id,
      { name: "master_id", dataType: "string", required: true, description: "master id" },
      { name: "value", dataType: "string", required: true, description: "canonical stored value" },
      { name: "label", dataType: "string", required: true, description: "display label" },
      { name: "icon", dataType: "string", description: "optional leading glyph" },
      { name: "parent", dataType: "string", description: "dependency key" },
      { name: "version", dataType: "number", description: "manifest revision applied from" },
      updatedAt,
    ]),

  table("Partners", "myfinance_partners", "Internal",
    "Curated professional directory (doctors/lawyers/CAs) pushed OTA; contact fields auto-fill the person form.", [
      id,
      { name: "professional_type", dataType: "string", required: true, description: "professional type (matches the master)" },
      { name: "name", dataType: "string", required: true, personalData: true, purpose: "Show the professional's name in the directory.", description: "person or firm name" },
      { name: "phone", dataType: "string", personalData: true, purpose: "Contact the professional.", description: "phone" },
      { name: "email", dataType: "string", personalData: true, purpose: "Contact the professional.", description: "email" },
      { name: "notes", dataType: "string", description: "speciality/location blurb" },
      { name: "icon", dataType: "string", description: "optional leading glyph" },
      { name: "version", dataType: "number", description: "manifest revision applied from" },
      updatedAt,
    ]),

  table("SyncTombstones", "myfinance_sync_tombstones", "Internal",
    "Deletion log for LAN sync — lets a delete on one device propagate instead of resurrecting.", [
      { name: "table_name", dataType: "string", keyField: true, description: "namespaced table the row was deleted from" },
      { name: "key", dataType: "string", keyField: true, description: "sync identity of the deleted row" },
      { name: "deleted_at", dataType: "date", description: "deletion timestamp" },
    ]),

  table("MigrationLedger", "myfinance_migration_ledger", "Internal",
    "Ledger of the one-time legacy myfinance.db → suite.db consolidation (decisions 6/24): per-table copy/verify evidence rows plus the final 'migration' done marker. Append-only audit trail making the migration idempotent, resumable, and auditable.", [
      { name: "entry_id", dataType: "id", keyField: true, description: "'table:<legacy name>' or 'migration'" },
      { name: "table_name", dataType: "string", description: "legacy table copied (null for the completion marker)" },
      { name: "legacy_rows", dataType: "number", description: "rows in the legacy table" },
      { name: "copied_rows", dataType: "number", description: "rows copied into the suite table" },
      { name: "checksum", dataType: "string", description: "FNV-1a hash of the ordered row sample (legacy side, verified equal on the suite side)" },
      { name: "status", dataType: "string", required: true, description: "done | no-legacy" },
      { name: "detail", dataType: "string", description: "free-text detail" },
      { name: "completed_at", dataType: "date", required: true, description: "ISO timestamp" },
    ]),

  // ── Adoption: the legacy single-row `health_profile` is RETIRED in favor of the
  // suite's single shared emergency card (`common#IceCard`). This descriptor creates
  // NO table — it documents that myFinance USES the common card (invariant 6) and
  // exempts the dependency from the duplicate hard-block. Field list mirrors the
  // mapped IceCard columns; `db/health.ts` does the mapping.
  table("HealthProfile", "common_ice_card", "Restricted",
    "Hospitalisation-ready medical facts for the ICE card — stored ONCE suite-wide on the common ICE card.", [
      { name: "person_key", dataType: "id", keyField: true, description: "'self' for the user's own card" },
      { name: "display_name", dataType: "string", personalData: true, purpose: "Name shown on the emergency card.", description: "maps the legacy full_name" },
      { name: "blood_group", dataType: "string", personalData: true, purpose: "Critical for emergency transfusion decisions.", description: "blood group" },
      { name: "allergies", dataType: "string", personalData: true, purpose: "Allergies first responders must know.", description: "allergies" },
      { name: "conditions", dataType: "string", personalData: true, purpose: "Conditions first responders must know.", description: "maps the legacy chronic_conditions" },
      { name: "medications", dataType: "string", personalData: true, purpose: "Current medications first responders must know.", description: "medications" },
      { name: "organ_donor", dataType: "boolean", description: "registered organ donor" },
      { name: "notes", dataType: "string", personalData: true, purpose: "Any other emergency note.", description: "notes" },
      updatedAt,
    ], { adopts: "common#IceCard" }),
];
