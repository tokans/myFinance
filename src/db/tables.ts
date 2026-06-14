/**
 * K1 consolidation — the single source of truth for myFinance's physical table
 * names in the shared `suite.db`. Every table is `myfinance_*` (namespaced via
 * the descriptor dbAlias). The data-layer wrappers (`db/*.ts`), the aux-SQL
 * (`auxSql.ts`), the one-time migrator (`consolidate.ts`) and the legacy
 * descriptors (`legacySchemas.ts`) all reference these constants so a rename is
 * made in one place.
 *
 * The values intentionally match the `dbAlias` strings in `legacySchemas.ts`.
 */
export const APP_ID = "myfinance";

export const T = {
  settings: "myfinance_settings",
  vaultEntries: "myfinance_vault_entries",
  accounts: "myfinance_accounts",
  monthlySnapshot: "myfinance_monthly_snapshot",
  goals: "myfinance_goals",
  taxYears: "myfinance_tax_years",
  taxIncome: "myfinance_tax_income",
  taxDeductions: "myfinance_tax_deductions",
  taxPayments: "myfinance_tax_payments",
  taxAssessment: "myfinance_tax_assessment",
  taxWizardAnswers: "myfinance_tax_wizard_answers",
  customOptions: "myfinance_custom_options",
  people: "myfinance_people",
  documents: "myfinance_documents",
  reminders: "myfinance_reminders",
  insurancePolicies: "myfinance_insurance_policies",
  holdings: "myfinance_holdings",
  willMeta: "myfinance_will_meta",
  incapacityMeta: "myfinance_incapacity_meta",
  accessGrants: "myfinance_access_grants",
  auditLog: "myfinance_audit_log",
  lifeEvents: "myfinance_life_events",
  appLaunches: "myfinance_app_launches",
  masterOptions: "myfinance_master_options",
  partners: "myfinance_partners",
  syncTombstones: "myfinance_sync_tombstones",
  migrationLedger: "myfinance_migration_ledger",
} as const;

export type TableName = (typeof T)[keyof typeof T];
