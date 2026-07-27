/**
 * Form 26AS's TDS summary: one row per deductor, each with a nested
 * per-transaction breakup.
 *
 * Reads a structured `DocModel`. The builder now handles what used to be
 * hand-rolled here — finding the Part-I section, treating the header TRACES
 * reprints before every deductor as one continuing table, merging its
 * two-line header, and nesting each deductor's breakup sub-table under the
 * deductor it belongs to. What remains is the mapping, plus one piece of
 * genuine domain knowledge the structure cannot supply (below).
 *
 * NOT shared with Form 16: a Form 16 covers exactly one employer, so its Part
 * A table is quarter-indexed with the employer stated once as header
 * metadata, rather than deductor-indexed. See `form16TdsTable.ts`.
 */
import { findSection, sectionTables, sections, type DocModel, type DocNode, type DocRecord, type DocTable } from "@scandoc/core/docmodel";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

export type TdsColumnKind = "deductor" | "tan" | "amountPaid" | "taxDeducted";

const DEDUCTOR_WORDS = /\b(name of (the )?deductor|deductor)\b/i;
const TAN_WORDS = /\btan\b/i;
const AMOUNT_PAID_WORDS = /\b(amount paid|amount credited|total amount)\b/i;
const TAX_DEDUCTED_WORDS = /\b(tax deducted|total tax deducted)\b/i;

export function classifyTdsHeaderCell(text: string): TdsColumnKind | null {
  const t = text.trim();
  if (!t) return null;
  if (TAN_WORDS.test(t)) return "tan";
  if (DEDUCTOR_WORDS.test(t)) return "deductor";
  if (TAX_DEDUCTED_WORDS.test(t)) return "taxDeducted";
  if (AMOUNT_PAID_WORDS.test(t)) return "amountPaid";
  return null;
}

/** A 10-character Indian TAN: 4 letters, 5 digits, 1 letter. */
const TAN_PATTERN = /^[A-Z]{4}\d{5}[A-Z]$/;

/**
 * Only "PART-I", never PART-II/IV/VI/IX.
 *
 * The negative lookahead does a word boundary's job. Written this way on
 * purpose: a `\b` in this file's sibling once reached disk as a literal 0x08
 * byte, making its regex match nothing at all while still looking correct in
 * an editor. A lookahead survives a tool that interprets string escapes.
 */
const PART_ONE_HEADING = /^part[\s-]*i(?![a-z0-9])/i;

export interface TdsTransactionEntry {
  section: string | null;
  transactionDate: string | null;
  dateOfBooking: string | null;
  status: string | null;
  amountPaid: number | null;
  taxDeducted: number | null;
}

export interface TdsRow {
  deductorName: string;
  tan: string | null;
  amountPaid: number | null;
  taxDeducted: number | null;
  /** The deductor's per-transaction breakup as printed beneath it. Useful for
   *  reconciling against real bank transactions by date rather than only the
   *  deductor-level total. Empty when the document didn't carry one. */
  transactions: TdsTransactionEntry[];
}

export interface TdsTableParseResult {
  rows: TdsRow[];
  warnings: string[];
}

/**
 * Reads one deductor row from the cells printed on it, rather than from the
 * column its text landed under.
 *
 * This is the one piece the structure genuinely cannot replace. TRACES packs
 * three of its header labels ("TAN of Deductor", "Total Amount Paid/
 * Credited", "Total Tax Deducted") tightly enough that they arrive already
 * merged into a single header cell, so the columns are not separately
 * identifiable however the table is modelled — the *header itself* is
 * ambiguous. A TAN is a fixed, regex-matchable format though, so the row can
 * be read positionally around it: the cell before is the deductor's name, and
 * the parseable amounts after it are, in printed order, the total paid and
 * the total deducted.
 */
function fromTanAnchor(parts: string[]): Omit<TdsRow, "transactions"> | null {
  const tanIndex = parts.findIndex((p) => TAN_PATTERN.test(p.trim()));
  if (tanIndex < 1) return null; // needs a name cell before the TAN

  const amounts: number[] = [];
  for (let i = tanIndex + 1; i < parts.length; i++) {
    const value = parseAmount(parts[i]);
    if (value !== null) amounts.push(value);
  }
  if (amounts.length === 0) return null;

  return {
    deductorName: parts[tanIndex - 1].trim(),
    tan: parts[tanIndex].trim(),
    amountPaid: amounts[0],
    taxDeducted: amounts[1] ?? null,
  };
}

/** Reads a deductor row by its column headers — the straightforward layout
 *  (a flat xlsx export, a portal that doesn't merge its header labels). */
function fromHeaders(table: DocTable, record: DocRecord): Omit<TdsRow, "transactions"> | null {
  const byKind = (kind: TdsColumnKind): string | null => {
    const header = table.headers.find((h) => classifyTdsHeaderCell(h) === kind);
    return header ? record.cells[header] ?? null : null;
  };

  // Without a deductor column there is no deductor row to read. Skipping this
  // guard lets a nested per-transaction table — which does have a "Tax
  // Deducted" column — yield a nameless phantom deductor for every
  // transaction in it.
  if (!table.headers.some((h) => classifyTdsHeaderCell(h) === "deductor")) return null;

  const deductor = byKind("deductor");
  // Parsed, not merely present: an unrelated row's stray text can land inside
  // the amount column's tolerance without being a number, and a presence-only
  // check would push a phantom deductor with a garbage name.
  const taxDeducted = parseAmount(byKind("taxDeducted") ?? "");
  if (!deductor && taxDeducted === null) return null;

  return {
    deductorName: deductor ?? "",
    tan: byKind("tan"),
    amountPaid: parseAmount(byKind("amountPaid") ?? ""),
    taxDeducted,
  };
}

/**
 * Reads one per-transaction row of a deductor's breakup.
 *
 * Recognized by shape rather than header, for the same reason as the summary
 * row: the breakup's own header ("Amount Paid"/"Tax Deducted", without the
 * summary's "Total" prefix) is close enough to the summary's wording to be
 * ambiguous. Two date-shaped cells in one row — transaction date, then date
 * of booking — is a signature nothing else in this table has.
 */
function transactionFromParts(parts: string[]): TdsTransactionEntry | null {
  const dateIndexes: number[] = [];
  parts.forEach((p, i) => {
    if (parseStatementDate(p.trim()) !== null) dateIndexes.push(i);
  });
  if (dateIndexes.length < 2) return null;
  const [txIndex, bookingIndex] = dateIndexes;

  const amounts: number[] = [];
  for (let i = bookingIndex + 1; i < parts.length; i++) {
    const value = parseAmount(parts[i]);
    if (value !== null) amounts.push(value);
  }
  if (amounts.length === 0) return null;

  // Whatever sits between the two dates is the booking status ("F"); some
  // rows omit it, leaving the dates adjacent.
  const between = parts.slice(txIndex + 1, bookingIndex).map((p) => p.trim()).filter(Boolean);

  return {
    section: parts[txIndex - 1]?.trim() || null,
    transactionDate: parseStatementDate(parts[txIndex].trim()),
    status: between[0] ?? null,
    dateOfBooking: parseStatementDate(parts[bookingIndex].trim()),
    amountPaid: amounts[0] ?? null,
    taxDeducted: amounts[1] ?? null,
  };
}

/** Every transaction nested under a deductor record, from whatever sub-tables
 *  the document printed beneath it. */
function transactionsOf(record: DocRecord): TdsTransactionEntry[] {
  const out: TdsTransactionEntry[] = [];
  for (const child of record.children ?? []) {
    if (child.kind !== "table") continue;
    for (const sub of child.records) {
      const entry = transactionFromParts(sub.parts);
      if (entry) out.push(entry);
    }
  }
  return out;
}

/**
 * Scopes to Part-I when the document names its parts.
 *
 * 26AS's other parts repeat the exact same "TAN-shaped token + trailing
 * amounts" shape for entirely different concepts — Part-VI's tax-COLLECTED
 * rows are structurally identical to Part-I's tax-DEDUCTED ones. Without this
 * scope a collector would silently join the deductor list. Falls back to the
 * whole document when no part headings exist (a flat xlsx export).
 */
function scopeToPartOne(model: DocModel): DocModel | DocNode[] {
  const partOne = findSection(model, PART_ONE_HEADING);
  return partOne ? partOne.children : model;
}

/** Whether the document has a Part-I section at all. */
function hasPartOne(model: DocModel): boolean {
  return sections(model).some((s) => PART_ONE_HEADING.test(s.title));
}

export function parseTdsDoc(model: DocModel): TdsTableParseResult {
  const warnings: string[] = [];
  const rows: TdsRow[] = [];
  let orphanTransactions = 0;
  const scope = scopeToPartOne(model);
  const found = sectionTables(scope);

  for (const table of found) {
    // Which reading to trust depends on whether this table's header actually
    // names its amount columns. When it does, the header is authoritative: a
    // table carrying only "Total Tax Deducted" has one amount, and the anchor
    // — which assigns amounts by printed order, paid-then-deducted — would
    // file it as the amount PAID and report no tax at all. When the header
    // labels arrive merged (TRACES), no column is separately identifiable and
    // the anchor is the only thing that can read the row.
    const named = (kind: TdsColumnKind): boolean => table.headers.some((h) => classifyTdsHeaderCell(h) === kind);
    const headersAreUsable = named("deductor") && (named("amountPaid") || named("taxDeducted"));

    for (const record of table.records) {
      const summary = headersAreUsable
        ? fromHeaders(table, record) ?? fromTanAnchor(record.parts)
        : fromTanAnchor(record.parts) ?? fromHeaders(table, record);
      if (!summary) {
        // A row that reads as a transaction but sits at the top level belongs
        // to a deductor that was never recognized — worth saying so, since the
        // figures in it are real and are being left out.
        if (transactionFromParts(record.parts)) orphanTransactions++;
        continue;
      }
      rows.push({ ...summary, transactions: transactionsOf(record) });
    }
  }

  if (rows.length === 0 && !hasPartOne(model)) {
    // Only when nothing parsed: a flat export (an xlsx with no part headings)
    // legitimately has no Part-I section and still reads fine, so this must
    // not fire whenever the heading is merely absent.
    warnings.push("Couldn't find PART-I (Details of Tax Deducted at Source) in this document.");
  }
  if (rows.length === 0) {
    const anyDeductorColumn = found.some((t) => t.headers.some((h) => classifyTdsHeaderCell(h) === "deductor"));
    if (!anyDeductorColumn) {
      warnings.push("Couldn't find a 'Name of Deductor' column — check this is the right TDS summary page.");
    }
    warnings.push("No TDS rows were recognized in this document.");
  }
  if (orphanTransactions > 0) {
    warnings.push(
      `${orphanTransactions} per-transaction detail row(s) couldn't be attributed to a deductor and were skipped.`,
    );
  }

  return { rows, warnings };
}
