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
export type ParentTable = "vault_entries" | "accounts" | "people" | "documents";

/**
 * Physical (suite.db) table name for each LOGICAL sync name. Post-consolidation the
 * sync `table` field stays the LOGICAL identity (it is the bundle key AND the
 * `sync_tombstones.table_name` value the aux DELETE triggers write), while the actual
 * SQL addresses the namespaced `myfinance_*` table. This map bridges the two.
 */
export const PHYSICAL: Record<string, string> = {
  vault_entries: T.vaultEntries,
  accounts: T.accounts,
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
    table: "people",
    pk: "id",
    columns: [
      "sync_id", "name", "relationship", "phone", "email", "id_proof_ref",
      "access_tier", "notes", "created_at", "updated_at",
    ],
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
    columns: ["sync_id", "ay", "head", "label", "amount", "source_path", "note", "updated_at"],
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
    columns: ["sync_id", "ay", "type", "payer_name", "amount", "source_path", "note", "updated_at"],
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
