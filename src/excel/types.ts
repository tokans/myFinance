import type { AccountType } from "@/lib/accountTypes";

export interface SheetRaw {
  name: string;
  /** All cells as a 2D array (rows × cols). Empty cells are null. */
  rows: (string | number | null)[][];
  /** Formula cells (with their formula string). Optional — absent for fixtures or formula-free sheets. */
  formulas?: FormulaCell[];
}

export interface FormulaCell {
  /** 0-indexed row. */
  row: number;
  /** 0-indexed column. */
  col: number;
  /** Raw formula string, e.g. "SUM(B2:B10)" (without leading '='). */
  formula: string;
}

export interface FormulaInsight {
  /** 0-indexed row containing the totals. */
  totalRow: number;
  /** 0-indexed columns that have aggregating formulas (sorted). */
  valueCols: number[];
  /** 0-indexed first row of data. */
  dataStartRow: number;
  /** 0-indexed last row of data (inclusive). */
  dataEndRow: number;
  /** 0 to 1 — share of value-column formulas that agree on the data range. */
  confidence: number;
  /** Number of value-column formulas that contributed. */
  formulaCount: number;
}

export interface CrossSheetPattern {
  /** Pattern values shared by sheets that match. */
  totalRow: number;
  valueCols: number[];
  dataStartRow: number;
  dataEndRow: number;
  /** Names of sheets that match this pattern. */
  matchingSheets: string[];
  /** Total sheets in the workbook. */
  totalSheets: number;
  /** Confidence as a fraction of sheets that match. */
  confidence: number;
}

/**
 * How a value column should be interpreted:
 * - "balance" — the cell IS the account's balance for that month (stored directly).
 * - "credit"  — the cell is money added during the month; balance = prev month + cell.
 * - "debit"   — the cell is money removed during the month; balance = prev month − cell.
 */
export type ValueKind = "balance" | "credit" | "debit";

/**
 * A value column's stored selection. Extends ValueKind with:
 * - "credit_card" — the column is a credit-card balance for a SEPARATE liability
 *   account (e.g. "HDFC – Credit Card") rather than part of the row's main account.
 * - "unselected"  — the user hasn't chosen how to read this column yet (the default).
 * - "ignore"      — explicitly skipped.
 * "unselected"/"ignore" never import; the ValueKinds and "credit_card" produce snapshots.
 */
export type ColumnKind = ValueKind | "credit_card" | "unselected" | "ignore";

/** A single extracted data point before it's matched to an account. */
export interface ExtractedRow {
  item: string;
  value: number;
  kind: ValueKind;
  /** Account type to use when auto-creating this account (e.g. credit_card columns). */
  accountType?: AccountType;
  /** Institution guessed from the item name (e.g. "HDFC Savings" → "HDFC Bank"). */
  institution?: string;
  /** 'YYYY-MM-DD' maturity date read from a "maturity" column, for FD rows only. */
  maturityDate?: string;
  /** Free-text "what to do" read from an emergency/action/contact column. */
  emergencyAction?: string;
  /** Free-text contact (name + phone/email) read from a contact column. */
  contact?: string;
}

export interface SheetPlan {
  sheetName: string;
  /** Whether this sheet will be imported. */
  include: boolean;
  /** YYYY-MM. */
  month: string;
  /** 0-indexed row containing column headers (or -1 if no header). */
  headerRow: number;
  /** 0-indexed column for item name. */
  itemCol: number;
  /** 0-indexed list of value columns. Primary first. */
  valueCols: number[];
  /** Header text for each value column (parallel to valueCols). Empty when no header row. */
  valueColHeaders: string[];
  /** How to read each value column (parallel to valueCols). Defaults to "unselected". */
  valueKinds: ColumnKind[];
  /** If true, parsing stops at a row whose itemCol equals "total" (case-insensitive). Defaults true. */
  stopOnTotal: boolean;
  /** 0-indexed last row of data, exclusive of any total row. Optional — when set, extraction stops here. */
  dataEndRow?: number;
  /** 0-indexed column whose header contains "maturity"; used to prefill FD maturity dates. */
  maturityCol?: number;
  /** 0-indexed column whose header reads like "what to do"/"emergency"/"action"/"contacts". */
  emergencyActionCol?: number;
  /** 0-indexed column whose header reads like a dedicated phone/contact column. */
  contactCol?: number;
}

export interface DetectionResult {
  /** True when every sheet auto-detected cleanly. */
  allMatchDefault: boolean;
  plans: SheetPlan[];
  /** Per-sheet reason if detection wasn't clean. */
  warnings: Record<string, string>;
  /** Per-sheet formula insight, if formulas yielded a verdict. */
  formulaInsights: Record<string, FormulaInsight>;
  /** Cross-sheet pattern from formulas, if a consistent one was found. */
  pattern: CrossSheetPattern | null;
}

export interface PreviewRow {
  item: string;
  value: number;
  /** How `value` is interpreted (balance / credit / debit). */
  kind: ValueKind;
  matchedAccountId: number | null;
  /** Account type to use when this row creates a new account (e.g. credit_card). */
  accountType?: AccountType;
  /** Institution guessed from the item name, used when creating a new account. */
  institution?: string;
  /** 'YYYY-MM-DD' maturity date to prefill for FD rows, from a "maturity" column. */
  maturityDate?: string;
  /** "What to do" note read from an emergency/action/contact column. */
  emergencyAction?: string;
  /** Contact (name + phone/email) read from a contact column. */
  contact?: string;
}

export interface SheetPreview {
  sheetName: string;
  month: string;
  rows: PreviewRow[];
  errors: string[];
}
