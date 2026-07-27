/**
 * Declarative description of how every user-data table participates in a
 * device-to-device sync. The bundle builder ({@link ./bundle}) and the merge
 * engine ({@link ./merge}) are both driven entirely by this list, so adding a
 * column or a table is a one-line change here rather than edits scattered
 * across two code paths.
 *
 * Identity:
 *  - `uuid`      — matched across devices on the `sync_id` column (migration 0021).
 *  - `natural`   — matched on a tuple of business columns (e.g. account+month);
 *                  used where two devices would independently create "the same"
 *                  row and a `sync_id` clash is undesirable.
 *  - `singleton` — the pinned id=1 row (health/will/incapacity metadata).
 *
 * Foreign keys are exported/imported as the PARENT's `sync_id`, never the local
 * autoincrement id, and remapped to the local id on arrival. Only integer FKs to
 * id-keyed parents are listed here; text `ay` foreign keys are already stable
 * across devices and pass through untouched.
 *
 * Order matters: parents precede children so the merge engine has each parent's
 * sync_id→localId mapping built before a child that references it is applied.
 */

import { T } from "@/db/tables";

/** Parent tables other rows point at; each gets a sync_id↔localId map at merge time. */
export type ParentTable = "vault_entries" | "accounts" | "people" | "documents" | "transactions";

/**
 * Physical (suite.db) table name for each LOGICAL sync name. Post-consolidation the
 * sync `table` field stays the LOGICAL identity (it is the bundle key AND the
 * `sync_tombstones.table_name` value the aux DELETE triggers write), while the actual
 * SQL addresses the namespaced `myfinance_*` table. This map bridges the two.
 */
export const PHYSICAL: Record<string, string> = {
  vault_entries: T.vaultEntries,
  accounts: T.accounts,
  transactions: T.transactions,
  people: T.people,
  documents: T.documents,
  goals: T.goals,
  monthly_snapshot: T.monthlySnapshot,
  custom_options: T.customOptions,
  reminders: T.reminders,
  insurance_policies: T.insurancePolicies,
  holdings: T.holdings,
  access_grants: T.accessGrants,
  life_events: T.lifeEvents,
  will_meta: T.willMeta,
  incapacity_meta: T.incapacityMeta,
  tax_years: T.taxYears,
  tax_income: T.taxIncome,
  tax_deductions: T.taxDeductions,
  tax_payments: T.taxPayments,
  tax_assessment: T.taxAssessment,
  tax_wizard_answers: T.taxWizardAnswers,
  ais_sft: T.aisSft,
  tax_refunds: T.taxRefunds,
  category_rules: T.categoryRules,
  transaction_tags: T.transactionTags,
};

/** Physical name for a logical sync table name (throws on an unmapped name). */
export function physicalTable(logical: string): string {
  const p = PHYSICAL[logical];
  if (!p) throw new Error(`sync: no physical table mapped for "${logical}"`);
  return p;
}

export interface Fk {
  /** Local column holding the parent's autoincrement id. */
  col: string;
  parent: ParentTable;
  /** When true the row is dropped if the parent can't be resolved (NOT NULL FK). */
  required?: boolean;
}

export type Identity =
  | { kind: "uuid" }
  | { kind: "natural"; cols: string[] }
  | { kind: "singleton" };

export interface TableSpec {
  table: string;
  /** Primary-key column used in UPDATE/DELETE WHERE clauses. */
  pk: string;
  /** Columns transferred in the bundle (excludes an autoincrement `id`). */
  columns: string[];
  identity: Identity;
  fks: Fk[];
  /** If this table is an FK target, the map key under which to register it. */
  isParent?: ParentTable;
  /** Optional SQL filter applied on export (raw, no params). */
  exportWhere?: string;
}

export const SPEC: TableSpec[] = [
  {
    table: "vault_entries",
    pk: "id",
    columns: ["sync_id", "label", "stronghold_key", "created_at", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
    isParent: "vault_entries",
  },
  {
    table: "accounts",
    pk: "id",
    columns: [
      "sync_id", "name", "type", "institution", "currency", "opening_balance",
      "credential_id", "is_archived", "created_at", "type_note", "maturity_date",
      "contact", "emergency_action", "holding_mode",
      "sip_day", "sip_amount", "sip_last_done", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [{ col: "credential_id", parent: "vault_entries" }],
    isParent: "accounts",
  },
  {
    // Desktop-only feature. `matched_transaction_id`/`match_status` are deliberately
    // excluded here: it's a self-referencing FK (self-transfer counterpart), a real
    // cycle the single-pass merge engine can't safely resolve — match state stays
    // device-local, each device recomputes/reviews its own reconciliation candidates.
    // `category`/`category_source` are LEGACY (superseded by transaction_tags below,
    // which categorization now lives on) — no longer synced, only ever stale NULLs
    // going forward. `isParent` lets transaction_tags remap FK by this row's sync_id.
    table: "transactions",
    pk: "id",
    columns: [
      "sync_id", "account_id", "date", "raw_date", "description", "debit", "credit",
      "balance", "source_path", "created_at", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [{ col: "account_id", parent: "accounts", required: true }],
    isParent: "transactions",
  },
  {
    // THIN spine link (finding 2.1, invariant 6): identity lives on common_person and the
    // finance estate fields on myfinance_person_facet — both keyed by person_key and synced
    // via the core shared-entity path, NOT here (same precedent as the health card, above).
    // Only the link row (id ↔ person_key) travels so the estate FK remap keeps working.
    table: "people",
    pk: "id",
    columns: ["sync_id", "person_key", "created_at", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
    isParent: "people",
  },
  {
    table: "documents",
    pk: "id",
    columns: [
      "sync_id", "type", "title", "file_name", "mime", "size", "encrypted",
      "account_id", "person_id", "issued_on", "expires_on",
      "location_of_original", "notes", "created_at", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [
      { col: "account_id", parent: "accounts" },
      { col: "person_id", parent: "people" },
    ],
    isParent: "documents",
  },
  {
    table: "goals",
    pk: "id",
    columns: [
      "sync_id", "name", "target_amount", "target_date", "baseline_month",
      "account_filter", "created_at", "archived_at", "category", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [],
  },
  {
    table: "monthly_snapshot",
    pk: "id",
    columns: ["account_id", "month", "value", "note", "source", "updated_at"],
    identity: { kind: "natural", cols: ["account_id", "month"] },
    fks: [{ col: "account_id", parent: "accounts", required: true }],
  },
  {
    table: "custom_options",
    pk: "id",
    columns: ["category", "value", "label", "parent", "created_at", "updated_at"],
    identity: { kind: "natural", cols: ["category", "parent", "value"] },
    fks: [],
  },
  {
    // Learned classifier memory (db/categoryRules.ts) — natural-keyed on the
    // (pattern, category) pair so two devices teaching the same merchant
    // converge on one row rather than duplicate it, same reasoning as custom_options.
    table: "category_rules",
    pk: "id",
    columns: ["pattern", "category", "hit_count", "created_at", "updated_at"],
    identity: { kind: "natural", cols: ["pattern", "category"] },
    fks: [],
  },
  {
    table: "reminders",
    pk: "id",
    columns: [
      "sync_id", "type", "title", "notes", "due_date", "cadence", "source",
      "dedupe_key", "status", "snoozed_until", "last_fired_on",
      "account_id", "document_id", "person_id", "created_at", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [
      { col: "account_id", parent: "accounts" },
      { col: "document_id", parent: "documents" },
      { col: "person_id", parent: "people" },
    ],
    // Derived reminders are regenerated locally from FD/document data, so only
    // user-created ones travel.
    exportWhere: "source = 'manual'",
  },
  {
    table: "insurance_policies",
    pk: "id",
    columns: [
      "sync_id", "account_id", "kind", "insurer", "policy_no", "sum_assured",
      "premium", "renewal_date", "tpa", "network_hospitals",
      "claims_contact_person_id", "notes", "created_at", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [
      { col: "account_id", parent: "accounts" },
      { col: "claims_contact_person_id", parent: "people" },
    ],
  },
  {
    table: "holdings",
    pk: "id",
    columns: [
      "sync_id", "account_id", "person_id", "role", "share_pct", "position",
      "sec39_beneficial", "created_at", "updated_at",
    ],
    identity: { kind: "uuid" },
    fks: [
      { col: "account_id", parent: "accounts", required: true },
      { col: "person_id", parent: "people", required: true },
    ],
  },
  {
    table: "access_grants",
    pk: "id",
    columns: ["sync_id", "person_id", "tier", "scope", "trigger", "created_at", "updated_at"],
    identity: { kind: "uuid" },
    fks: [{ col: "person_id", parent: "people", required: true }],
  },
  {
    table: "life_events",
    pk: "id",
    columns: ["sync_id", "type", "event_date", "notes", "created_at", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
  },
  // health_profile is no longer an app table — the medical card lives on the shared
  // common ICE card (invariant 6) and syncs via the core's shared-entity path, not here.
  {
    table: "will_meta",
    pk: "id",
    columns: [
      "has_will", "executor_person_id", "guardian_person_id", "registered",
      "registration_details", "location_of_original", "probate_required",
      "notes", "updated_at",
    ],
    identity: { kind: "singleton" },
    fks: [
      { col: "executor_person_id", parent: "people" },
      { col: "guardian_person_id", parent: "people" },
    ],
  },
  {
    table: "incapacity_meta",
    pk: "id",
    columns: [
      "poa_attorney_person_id", "poa_kind", "poa_scope", "poa_registered",
      "poa_revoked", "amd_life_support", "amd_resuscitation",
      "amd_organ_donation", "amd_attestation", "notes", "updated_at",
    ],
    identity: { kind: "singleton" },
    fks: [{ col: "poa_attorney_person_id", parent: "people" }],
  },
  {
    table: "tax_years",
    pk: "ay",
    columns: ["ay", "itr_form", "itr_form_source", "imported_filename", "notes", "created_at", "updated_at"],
    identity: { kind: "natural", cols: ["ay"] },
    fks: [],
  },
  {
    table: "tax_income",
    pk: "id",
    // `excluded` is set by the reconciliation screen when the user
    // confirms this row duplicates another source document's row for the
    // same real-world event — a plain content field, syncs normally.
    columns: ["sync_id", "ay", "head", "label", "amount", "source_path", "note", "excluded", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
  },
  {
    table: "tax_deductions",
    pk: "id",
    columns: ["sync_id", "ay", "section", "label", "amount", "source_path", "note", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
  },
  {
    table: "tax_payments",
    pk: "id",
    columns: ["sync_id", "ay", "type", "payer_name", "amount", "source_path", "note", "excluded", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
  },
  {
    table: "tax_assessment",
    pk: "ay",
    columns: [
      "ay", "gross_total_income", "total_deductions", "total_income",
      "total_tax_payable", "rebate_87a", "education_cess", "net_tax_liability",
      "total_taxes_paid", "refund_or_balance", "updated_at",
    ],
    identity: { kind: "natural", cols: ["ay"] },
    fks: [],
  },
  {
    table: "tax_wizard_answers",
    pk: "ay",
    columns: ["ay", "answers", "recommended", "rationale", "updated_at"],
    identity: { kind: "natural", cols: ["ay"] },
    fks: [],
  },
  {
    table: "ais_sft",
    pk: "id",
    columns: ["sync_id", "ay", "sft_code", "description", "reporting_entity", "amount", "date", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
  },
  {
    table: "tax_refunds",
    pk: "id",
    columns: ["sync_id", "ay", "amount", "mode", "refund_date", "source_path", "note", "updated_at"],
    identity: { kind: "uuid" },
    fks: [],
  },
  {
    // Replaces the old single category/category_source columns on transactions —
    // a transaction can carry multiple tags. Ordinary FK-to-parent shape (not the
    // polymorphic/self-referencing case recon_links/matched_transaction_id avoid).
    table: "transaction_tags",
    pk: "id",
    columns: ["sync_id", "transaction_id", "category", "source", "created_at", "updated_at"],
    identity: { kind: "uuid" },
    fks: [{ col: "transaction_id", parent: "transactions", required: true }],
  },
  // recon_links is deliberately NOT listed here — see its schema doc comment
  // in legacySchemas.ts/auxSql.ts: a_kind/a_id/b_kind/b_id is a polymorphic
  // local-id reference the single-pass sync merge engine can't safely remap
  // across devices, same reasoning transactions.matched_transaction_id is
  // device-local for. Each device recomputes its own recon candidates.
];

/** A bundle row is a flat column→value map (FK columns hold the parent's sync_id). */
export type Row = Record<string, unknown>;

export interface Tombstone {
  table_name: string;
  key: string;
  deleted_at: string;
}

/** A self-contained credential payload mirrored from the source vault. */
export interface SyncCredential {
  label: string;
  username: string;
  password: string;
  notes?: string;
}

export interface Bundle {
  version: 1;
  device_id: string;
  created_at: string;
  /** table name → rows (FKs expressed as parent sync_ids). */
  tables: Record<string, Row[]>;
  tombstones: Tombstone[];
  /** vault_entries.sync_id → decrypted credential (present only if vault unlocked). */
  credentials: Record<string, SyncCredential>;
  /** documents.sync_id → base64 of the DECRYPTED blob (present only if vault unlocked). */
  blobs: Record<string, string>;
}

/**
 * Tombstone key for a bundle row, matching the formats written by the AFTER
 * DELETE triggers in migration 0021. For natural-key tables the key joins the
 * identity columns with '|' (NULLs coerced to ''); FK identity columns already
 * hold the parent sync_id in the bundle, so the string lines up with the trigger
 * which used `parent.sync_id`.
 */
export function tombstoneKeyForRow(spec: TableSpec, row: Row): string {
  if (spec.identity.kind === "uuid") return String(row.sync_id);
  if (spec.identity.kind === "natural") {
    return spec.identity.cols.map((c) => (row[c] == null ? "" : String(row[c]))).join("|");
  }
  return spec.table; // singletons aren't tombstoned
}
