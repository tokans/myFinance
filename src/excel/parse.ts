import * as XLSX from "xlsx";
import type { DateFormat } from "@/db/settings";
import { inferAccountType } from "@/lib/accountTypes";
import { inferInstitution, inferAccountTypeForName } from "@/lib/institutions";
import { analyzeFormulas, findCrossSheetPattern } from "./formulas";
import type {
  ColumnKind, DetectionResult, ExtractedRow, FormulaCell, FormulaInsight, SheetPlan, SheetRaw, ValueKind,
} from "./types";

/** Read a binary xlsx (Uint8Array) into raw sheets (values + formulas). */
export function readWorkbook(data: Uint8Array): SheetRaw[] {
  const wb = XLSX.read(data, { type: "array", cellDates: true, cellFormula: true });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as (string | number | null)[][];

    // Walk cell addresses to harvest formulas. Skip SheetJS internal keys ('!ref', '!margins', etc.).
    const formulas: FormulaCell[] = [];
    for (const addr in sheet) {
      if (addr.startsWith("!")) continue;
      const cell = (sheet as Record<string, { f?: string }>)[addr];
      if (cell && typeof cell.f === "string" && cell.f.length > 0) {
        const { r, c } = XLSX.utils.decode_cell(addr);
        formulas.push({ row: r, col: c, formula: cell.f });
      }
    }

    return { name, rows, formulas };
  });
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_SHORT = MONTH_NAMES.map((n) => n.slice(0, 3));

/**
 * Try hard to parse a sheet name into YYYY-MM.
 * Supports a wide variety of formats — separator-based, no-separator numeric
 * (mmyy, mmyyyy, yyyymm, ddmmyy, ddmmyyyy, yyyymmdd), and alpha-month forms
 * (Apr26, April2026, 2026April, etc.). For ambiguous numerics the user's
 * Settings.dateFormat is used to choose between DDMMYY vs MMDDYY interpretations.
 * Returns null if unparseable.
 */
export function parseMonthFromSheetName(name: string, dateFormat: DateFormat = "DD/MM/YYYY"): string | null {
  const s = name.trim().toLowerCase();

  // -------- Separator-based numeric --------

  // YYYY-MM or YYYY/MM or YYYY.MM
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return formatMonth(Number(m[1]), Number(m[2]));

  // MM-YYYY or MM/YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return formatMonth(Number(m[2]), Number(m[1]));

  // DD-MM-YYYY, DD/MM/YYYY, MM/DD/YYYY (3 numeric components)
  m = s.match(/^(\d{1,4})[-/. ](\d{1,4})[-/. ](\d{1,4})$/);
  if (m) {
    const ym = pickYearMonthFromTriple(m[1], m[2], m[3], dateFormat);
    if (ym) return formatMonth(ym.year, ym.month);
  }

  // -------- Alpha month + year, separator or not --------

  // "Apr 2026" / "April 2026" / "Apr-2026" / "Apr2026"
  m = s.match(/^([a-z]+)[\s\-_]*(\d{4})$/);
  if (m) {
    const monthIdx = monthIndex(m[1]);
    if (monthIdx >= 0) return formatMonth(Number(m[2]), monthIdx + 1);
  }

  // "Apr-26" / "April 26" / "Apr26" (two-digit year)
  m = s.match(/^([a-z]+)[\s\-_]*(\d{2})$/);
  if (m) {
    const monthIdx = monthIndex(m[1]);
    if (monthIdx >= 0) {
      const year = expandYY(Number(m[2]));
      return formatMonth(year, monthIdx + 1);
    }
  }

  // "2026 April" / "2026Apr" / "2026-Apr"
  m = s.match(/^(\d{4})[\s\-_]*([a-z]+)$/);
  if (m) {
    const monthIdx = monthIndex(m[2]);
    if (monthIdx >= 0) return formatMonth(Number(m[1]), monthIdx + 1);
  }

  // "26 April" / "26Apr"
  m = s.match(/^(\d{2})[\s\-_]*([a-z]+)$/);
  if (m) {
    const monthIdx = monthIndex(m[2]);
    if (monthIdx >= 0) return formatMonth(expandYY(Number(m[1])), monthIdx + 1);
  }

  // -------- Pure numeric, no separators --------
  if (/^\d+$/.test(s)) {
    return parseAllNumeric(s, dateFormat);
  }

  return null;
}

function expandYY(yy: number): number {
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

function maybeYM(yearStr: string, monthStr: string): { year: number; month: number } | null {
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function maybeYM2(yyStr: string, monthStr: string): { year: number; month: number } | null {
  const yy = Number(yyStr);
  const month = Number(monthStr);
  if (!Number.isFinite(yy) || yy < 0 || yy > 99) return null;
  if (month < 1 || month > 12) return null;
  return { year: expandYY(yy), month };
}

type Layout =
  | "MMYY" | "YYMM"
  | "MMYYYY" | "YYYYMM"
  | "DDMMYY" | "MMDDYY" | "YYMMDD"
  | "DDMMYYYY" | "MMDDYYYY" | "YYYYMMDD";

function tryLayout(s: string, layout: Layout): { year: number; month: number } | null {
  switch (layout) {
    case "MMYY":     return s.length === 4 ? maybeYM2(s.slice(2, 4), s.slice(0, 2)) : null;
    case "YYMM":     return s.length === 4 ? maybeYM2(s.slice(0, 2), s.slice(2, 4)) : null;
    case "MMYYYY":   return s.length === 6 ? maybeYM(s.slice(2, 6), s.slice(0, 2)) : null;
    case "YYYYMM":   return s.length === 6 ? maybeYM(s.slice(0, 4), s.slice(4, 6)) : null;
    case "DDMMYY":   return s.length === 6 ? maybeYM2(s.slice(4, 6), s.slice(2, 4)) : null;
    case "MMDDYY":   return s.length === 6 ? maybeYM2(s.slice(4, 6), s.slice(0, 2)) : null;
    case "YYMMDD":   return s.length === 6 ? maybeYM2(s.slice(0, 2), s.slice(2, 4)) : null;
    case "DDMMYYYY": return s.length === 8 ? maybeYM(s.slice(4, 8), s.slice(2, 4)) : null;
    case "MMDDYYYY": return s.length === 8 ? maybeYM(s.slice(4, 8), s.slice(0, 2)) : null;
    case "YYYYMMDD": return s.length === 8 ? maybeYM(s.slice(0, 4), s.slice(4, 6)) : null;
  }
}

/**
 * Ordered list of layouts to try for a pure-digit string, given the user's
 * preferred date format. Earlier entries win on ambiguity.
 */
const NUMERIC_PRIORITY: Record<DateFormat, Layout[]> = {
  "DD/MM/YYYY": [
    "YYYYMM", "MMYYYY", "DDMMYYYY", "YYYYMMDD", "MMDDYYYY",
    "MMYY", "DDMMYY", "MMDDYY", "YYMMDD", "YYMM",
  ],
  "MM/DD/YYYY": [
    "YYYYMM", "MMYYYY", "MMDDYYYY", "YYYYMMDD", "DDMMYYYY",
    "MMYY", "MMDDYY", "DDMMYY", "YYMMDD", "YYMM",
  ],
  "YYYY-MM-DD": [
    "YYYYMM", "YYYYMMDD", "MMYYYY", "DDMMYYYY", "MMDDYYYY",
    "YYMM", "YYMMDD", "MMYY", "DDMMYY", "MMDDYY",
  ],
};

function parseAllNumeric(s: string, df: DateFormat): string | null {
  for (const layout of NUMERIC_PRIORITY[df]) {
    const r = tryLayout(s, layout);
    if (r) return formatMonth(r.year, r.month);
  }
  return null;
}

/**
 * Given 3 numeric components (e.g. "31"/"03"/"26" from DD-MM-YY), pick the year
 * and month. We try YYYY-MM-* first when one component is a 4-digit year, then
 * fall back to the user's DD/MM vs MM/DD preference.
 */
function pickYearMonthFromTriple(
  a: string, b: string, c: string, df: DateFormat,
): { year: number; month: number } | null {
  // If any one is 4 digits, it's the year. Then the month is the one that's 1..12.
  const parts = [a, b, c];
  const yearIdx = parts.findIndex((p) => p.length === 4 && Number(p) >= 1900 && Number(p) <= 2200);
  if (yearIdx !== -1) {
    const year = Number(parts[yearIdx]);
    const others = parts.filter((_, i) => i !== yearIdx).map(Number);
    // Position-aware: if year is last → DD/MM or MM/DD up front
    // if year is first → MM/DD or DD/MM after
    // Just pick whichever of the remaining two looks like a month (1..12) and matches DF order.
    const monthFirst = df === "MM/DD/YYYY";
    const tryOrder = monthFirst ? [others[0], others[1]] : [others[0], others[1]];
    for (const candidate of tryOrder) {
      if (candidate >= 1 && candidate <= 12) {
        return { year, month: candidate };
      }
    }
  }

  // All 2-digit: assume DDMMYY or MMDDYY based on dateFormat
  if (parts.every((p) => p.length <= 2)) {
    const [pa, pb, pc] = parts.map(Number);
    if (df === "MM/DD/YYYY") {
      if (pa >= 1 && pa <= 12) return { year: expandYY(pc), month: pa };
    } else {
      if (pb >= 1 && pb <= 12) return { year: expandYY(pc), month: pb };
    }
    // Fallback: try YY-MM-DD
    if (pb >= 1 && pb <= 12) return { year: expandYY(pa), month: pb };
  }

  return null;
}

function monthIndex(token: string): number {
  const t = token.toLowerCase();
  const full = MONTH_NAMES.indexOf(t);
  if (full >= 0) return full;
  return MONTH_SHORT.indexOf(t.slice(0, 3));
}

function formatMonth(year: number, monthOneBased: number): string | null {
  if (monthOneBased < 1 || monthOneBased > 12) return null;
  if (year < 1900 || year > 2200) return null;
  return `${year}-${String(monthOneBased).padStart(2, "0")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Convert an Excel date cell to a 'YYYY-MM-DD' string, or null if it isn't a
 * recognisable date. Handles the three shapes a cell can take after
 * {@link readWorkbook} (which reads with `cellDates: true`): a JS `Date`, an
 * Excel serial number, or a date-like string. Day precision only.
 */
export function parseExcelDate(cell: unknown): string | null {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    return `${cell.getFullYear()}-${pad2(cell.getMonth() + 1)}-${pad2(cell.getDate())}`;
  }
  if (typeof cell === "number" && Number.isFinite(cell)) {
    const d = XLSX.SSF.parse_date_code(cell);
    if (!d || !d.y) return null;
    return `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
  }
  if (typeof cell === "string") {
    const s = cell.trim();
    // Unambiguous ISO front (optionally with a time suffix).
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  }
  return null;
}

/** First column in a header row whose text contains "maturity", or undefined. */
function findMaturityCol(headerRow: (string | number | null)[] | undefined): number | undefined {
  if (!headerRow) return undefined;
  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c];
    if (v != null && String(v).toLowerCase().includes("maturity")) return c;
  }
  return undefined;
}

/** First column whose header matches any of `patterns`, optionally excluding one column. */
function findHeaderCol(
  headerRow: (string | number | null)[] | undefined,
  patterns: RegExp[],
  exclude?: number,
): number | undefined {
  if (!headerRow) return undefined;
  for (let c = 0; c < headerRow.length; c++) {
    if (c === exclude) continue;
    const v = headerRow[c];
    if (v == null) continue;
    const h = String(v).toLowerCase();
    if (patterns.some((p) => p.test(h))) return c;
  }
  return undefined;
}

// A contact-detail column (name/phone/RM) → the account's `contact` field.
// Checked first so a column literally named "Contact" feeds click-to-call rather
// than the free-text action note.
const CONTACT_HEADER = [/\bcontacts?\b/, /\bphone\b/, /\bmobile\b/, /\bnumber\b/, /\brm\b/, /relationship\s*manager/];
// "What to do" / emergency / action columns → the account's `emergency_action` field.
const EMERGENCY_HEADER = [/what\s*to\s*do/, /emergency/, /\bactions?\b/];

/** Is this cell mostly text? Numeric strings (incl. with thousands separators) count as numbers. */
function isTextCell(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s === "") return false;
  return Number.isNaN(Number(s.replace(/[, ]/g, "")));
}
function isNumberCell(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n);
  }
  return false;
}

// Header keywords that confidently signal how a value column should be read.
// Order matters: more specific phrases are matched as whole-word patterns.
const CREDIT_WORDS = ["credit", "deposit", "deposited", "inflow", "added", "contribution", "contributed", "invested", "paid in", "in"];
const DEBIT_WORDS = ["debit", "withdrawal", "withdrawn", "withdraw", "outflow", "spent", "expense", "redeemed", "redemption", "paid out", "out"];
const BALANCE_WORDS = ["balance", "bal", "closing", "closing balance", "amount", "value", "worth", "holding", "holdings", "corpus", "total"];

/**
 * Classify a value-column header as balance / credit / debit, or null when the
 * header gives no clear signal (caller should then default to "balance" and let
 * the user confirm). Matching is whole-word and case-insensitive so "in"/"out"
 * don't fire on "Investment" or "Payout".
 */
export function classifyValueKind(header: string | null | undefined): ValueKind | null {
  if (header == null) return null;
  const h = String(header).trim().toLowerCase();
  if (!h) return null;
  const hasWord = (word: string) =>
    new RegExp(`(^|[^a-z])${word.replace(/\s+/g, "\\s+")}([^a-z]|$)`).test(h);
  // Debit/credit are more specific intent than the generic balance words; check them first.
  if (DEBIT_WORDS.some(hasWord)) return "debit";
  if (CREDIT_WORDS.some(hasWord)) return "credit";
  if (BALANCE_WORDS.some(hasWord)) return "balance";
  return null;
}

/**
 * Like classifyValueKind but also recognises a credit-card column, which maps
 * to a separate liability account rather than the row's main account. Checked
 * first because "credit card" would otherwise match the generic "credit" word.
 * Used to pre-fill column roles; the user can still override in the wizard.
 */
export function classifyColumnKind(header: string | null | undefined): ColumnKind | null {
  if (header == null) return null;
  const h = String(header).trim().toLowerCase();
  if (!h) return null;
  if (/(^|[^a-z])(credit\s*card|cc)([^a-z]|$)/.test(h)) return "credit_card";
  return classifyValueKind(header);
}

/** Heuristic detection of a sheet's structure against the default schema. */
export function detectSheet(
  sheet: SheetRaw,
  dateFormat: DateFormat = "DD/MM/YYYY",
): { plan: SheetPlan; clean: boolean; reason?: string; insight?: FormulaInsight } {
  const month = parseMonthFromSheetName(sheet.name, dateFormat);
  const fallbackMonth = month ?? currentMonth();

  let headerRow = -1;
  let dataStart = -1;
  let valueCols: number[] = [];
  let itemCol = 0;

  // Rule 0 (strongest): use formulas if any vertical SUM-like formula is present.
  const insight = analyzeFormulas(sheet.formulas ?? []);
  if (insight && insight.formulaCount >= 1 && insight.confidence >= 0.5) {
    dataStart = insight.dataStartRow;
    valueCols = insight.valueCols;
    itemCol = Math.max(0, Math.min(...insight.valueCols) - 1);
    // If the row above the data is text in the item col or any value col, it's a header.
    if (dataStart > 0) {
      const candidate = sheet.rows[dataStart - 1];
      if (candidate && (isTextCell(candidate[itemCol]) || valueCols.some((c) => isTextCell(candidate[c])))) {
        headerRow = dataStart - 1;
      }
    }
  }

  // Rule 1: if row 0's col B has text, treat row 0 as a header row.
  if (dataStart === -1) {
    const firstRow = sheet.rows[0];
    if (firstRow && isTextCell(firstRow[1])) {
      headerRow = 0;
      dataStart = 1;
      valueCols = nonEmptyHeaderRange(firstRow, 1);
    }
  }

  // Rule 2 (fallback): scan rows for the first text|number pair.
  if (dataStart === -1) {
    for (let r = 0; r < Math.min(sheet.rows.length, 50); r++) {
      const row = sheet.rows[r];
      if (!row) continue;
      if (isTextCell(row[0]) && isNumberCell(row[1])) {
        dataStart = r;
        break;
      }
    }
    if (dataStart > 0) {
      const candidate = sheet.rows[dataStart - 1];
      if (candidate && isTextCell(candidate[1])) {
        headerRow = dataStart - 1;
        valueCols = nonEmptyHeaderRange(candidate, 1);
      }
    }
  }

  if (dataStart === -1) {
    return {
      plan: blankPlan(sheet.name, fallbackMonth),
      clean: false,
      reason: "Could not find a row matching the default 'item | value' shape.",
      insight: insight ?? undefined,
    };
  }

  if (valueCols.length === 0) {
    valueCols = [1];
  }

  const headerCells = headerRow >= 0 ? sheet.rows[headerRow] ?? [] : [];
  const valueColHeaders = valueCols.map((c) => {
    const v = headerCells[c];
    return v == null ? "" : String(v).trim();
  });
  // Read each value column's intent from its header; leave "unselected" when the
  // header gives no clear signal (never guess "balance" — the user picks in review).
  const valueKinds: ColumnKind[] = valueColHeaders.map((h) => classifyColumnKind(h) ?? "unselected");

  // Estate-readiness columns: a dedicated contact column (click-to-call) and a
  // free-text "what to do" / emergency / action column. Detected from headers
  // only; absent when the sheet has no header row.
  const headerForExtras = headerRow >= 0 ? sheet.rows[headerRow] : undefined;
  const contactCol = findHeaderCol(headerForExtras, CONTACT_HEADER);
  const emergencyActionCol = findHeaderCol(headerForExtras, EMERGENCY_HEADER, contactCol);

  const plan: SheetPlan = {
    sheetName: sheet.name,
    include: true,
    month: fallbackMonth,
    headerRow,
    itemCol,
    valueCols,
    valueColHeaders,
    valueKinds,
    stopOnTotal: true,
    dataEndRow: insight?.dataEndRow,
    maturityCol: headerRow >= 0 ? findMaturityCol(sheet.rows[headerRow]) : undefined,
    contactCol,
    emergencyActionCol,
  };

  if (!month) {
    return {
      plan,
      clean: false,
      reason: `Sheet name "${sheet.name}" doesn't look like a month — pick one manually.`,
      insight: insight ?? undefined,
    };
  }

  return { plan, clean: true, insight: insight ?? undefined };
}

/** From `startCol` rightward, collect column indexes whose header cell is non-empty (consecutive). */
function nonEmptyHeaderRange(row: (string | number | null)[], startCol: number): number[] {
  const cols: number[] = [];
  for (let c = startCol; c < row.length; c++) {
    const cell = row[c];
    if (cell == null) break;
    const s = String(cell).trim();
    if (s === "") break;
    cols.push(c);
  }
  return cols;
}

export function detectWorkbook(
  sheets: SheetRaw[],
  dateFormat: DateFormat = "DD/MM/YYYY",
): DetectionResult {
  const plans: SheetPlan[] = [];
  const warnings: Record<string, string> = {};
  const formulaInsights: Record<string, FormulaInsight> = {};
  let clean = true;
  for (const s of sheets) {
    const d = detectSheet(s, dateFormat);
    plans.push(d.plan);
    if (d.insight) formulaInsights[s.name] = d.insight;
    if (!d.clean) {
      clean = false;
      if (d.reason) warnings[s.name] = d.reason;
    }
  }
  const pattern = findCrossSheetPattern(sheets, formulaInsights);
  return { allMatchDefault: clean, plans, warnings, formulaInsights, pattern };
}

function blankPlan(sheetName: string, month: string): SheetPlan {
  return {
    sheetName, include: false, month, headerRow: -1, itemCol: 0,
    valueCols: [], valueColHeaders: [], valueKinds: [], stopOnTotal: true,
  };
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Extract (item, value) pairs from a sheet given a plan.
 *
 * - Iterates rows from `headerRow + 1` (or row 0 if no header).
 * - For each row, the item label is `row[itemCol]` (must be non-empty text).
 * - For each value column in `plan.valueCols` whose cell is a number, emit a pair.
 *   When a single row has multiple filled value columns, the column header is
 *   appended to the item name to keep them distinct (e.g. "HDFC – Mutual Fund").
 * - Each pair carries the value column's `kind` (balance/credit/debit) so commit
 *   knows whether the number is an absolute balance or a change to apply.
 * - When `plan.stopOnTotal` is true, stops at the first row whose item equals
 *   "total" (case-insensitive).
 */
export function extractRows(sheet: SheetRaw, plan: SheetPlan): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  const startRow = plan.headerRow === -1 ? 0 : plan.headerRow + 1;
  // An explicitly empty valueCols means the user ignored every value column → emit nothing.
  const valueCols = plan.valueCols ?? [];
  const headers = plan.valueColHeaders ?? valueCols.map(() => "");
  const kinds: ColumnKind[] = plan.valueKinds ?? valueCols.map(() => "unselected");
  const stopOnTotal = plan.stopOnTotal !== false;

  const endRow = plan.dataEndRow != null
    ? Math.min(plan.dataEndRow + 1, sheet.rows.length)
    : sheet.rows.length;
  for (let r = startRow; r < endRow; r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    const itemCell = row[plan.itemCol];
    if (itemCell == null) continue;
    if (typeof itemCell !== "string") continue;
    const item = itemCell.trim();
    if (!item) continue;
    if (stopOnTotal && item.toLowerCase() === "total") break;

    // A maturity date applies only to fixed-deposit rows; read it once per row.
    const rowMaturity =
      plan.maturityCol != null && plan.maturityCol >= 0
        ? parseExcelDate(row[plan.maturityCol]) ?? undefined
        : undefined;
    const fdMaturity = (name: string) =>
      rowMaturity && inferAccountType(name) === "fixed_deposit" ? rowMaturity : undefined;

    // Estate-readiness free-text, read once per row and attached to every account
    // the row produces.
    const cellText = (col: number | undefined): string | undefined => {
      if (col == null || col < 0) return undefined;
      const v = row[col];
      if (v == null) return undefined;
      const s = String(v).trim();
      return s || undefined;
    };
    const rowEmergencyAction = cellText(plan.emergencyActionCol);
    const rowContact = cellText(plan.contactCol);
    const extras = { emergencyAction: rowEmergencyAction, contact: rowContact };

    const cells: { value: number; header: string; kind: ColumnKind }[] = [];
    for (let i = 0; i < valueCols.length; i++) {
      const kind = kinds[i] ?? "unselected";
      // Only balance/credit/debit/credit_card import; unselected/ignored never do.
      if (kind !== "balance" && kind !== "credit" && kind !== "debit" && kind !== "credit_card") continue;
      const cell = row[valueCols[i]];
      if (cell == null || cell === "") continue;
      const value =
        typeof cell === "number"
          ? cell
          : Number(String(cell).replace(/[, ]/g, ""));
      if (!Number.isFinite(value)) continue;
      cells.push({ value, header: headers[i] ?? "", kind });
    }
    if (cells.length === 0) continue;

    // Credit-card columns are always their own liability account, named off the
    // base item so it reads as "<bank> – Credit Card".
    for (const c of cells.filter((c) => c.kind === "credit_card")) {
      out.push({
        item: c.header ? `${item} – ${c.header}` : `${item} – Credit Card`,
        value: c.value,
        kind: "balance",
        accountType: "credit_card",
        institution: inferInstitution(item) ?? undefined,
      });
    }

    const balances = cells.filter((c) => c.kind === "balance");
    const adjustments = cells.filter((c) => c.kind === "credit" || c.kind === "debit");

    if (balances.length > 0) {
      // Each balance column is its own account. A lone balance keeps the base
      // name; multiple balances disambiguate by header (two assets on one row).
      // Credit/debit columns are treated as informational here — balance wins.
      for (const b of balances) {
        const name = balances.length === 1 ? item : b.header ? `${item} – ${b.header}` : item;
        out.push({ item: name, value: b.value, kind: "balance", accountType: inferAccountTypeForName(name) ?? undefined, institution: inferInstitution(name) ?? undefined, maturityDate: fdMaturity(name), ...extras });
      }
    } else if (adjustments.length > 0) {
      // No balance for this account → fold all credit/debit columns into a single
      // net monthly change against the previous month's balance.
      const net = adjustments.reduce((sum, c) => sum + (c.kind === "credit" ? c.value : -c.value), 0);
      out.push({ item, value: Math.abs(net), kind: net >= 0 ? "credit" : "debit", accountType: inferAccountTypeForName(item) ?? undefined, institution: inferInstitution(item) ?? undefined, maturityDate: fdMaturity(item), ...extras });
    }
  }
  return out;
}
