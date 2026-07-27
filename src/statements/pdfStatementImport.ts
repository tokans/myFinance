import { listAccounts } from "@/db/accounts";
import { replaceTransactionsForSource } from "@/db/transactions";
import { commitImport, type CommitOptions, type CommitResult } from "@/excel/import";
import type { SheetPreview } from "@/excel/types";
import { writeDebugDump } from "@/lib/debugDump";
import { createParseLog } from "@/lib/parseLog";
import { sectionTables, type DocModel, type DocTable } from "@scandoc/core/docmodel";
import { parseAmount } from "./amount";
import { statementColumnClassifier } from "./columnDetect";
import { openDocument, type DocModelOverrides } from "./documentIntake";
import { parseStatementDate, splitLeadingDate } from "./parseDate";
import type {
  MonthlyBalance,
  ParsedTransaction,
  StatementColumnKind,
  StatementPreview,
} from "./types";

/**
 * Structuring options a bank statement needs beyond the app defaults.
 *
 * A narration that overflows its column wraps wherever the column ends —
 * frequently mid-word — so a folded continuation must join with nothing at
 * all. Inserting a space would split a reference number in half.
 */
export const STATEMENT_DOC_OPTIONS: DocModelOverrides = { foldSeparator: "" };

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Turns a structured statement into transactions.
 *
 * The structural work — finding the transaction table, treating a header
 * reprinted at each page break as one continuing table, folding a wrapped
 * narration onto the row above it (with a fold cap and a blank-row gap
 * check), and dropping page furniture that repeats verbatim — is all done by
 * the time this sees the model. What remains is the part that is genuinely
 * about bank statements: which column means what, and which rows are real
 * movements rather than markers.
 */
export function parseTransactionsFromDoc(
  model: DocModel,
  institution?: string | null,
): { transactions: ParsedTransaction[]; warnings: string[]; templateApplied: boolean } {
  const warnings: string[] = [];
  const { classify, applied } = statementColumnClassifier(institution);
  const found = sectionTables(model);

  const columnsOf = (table: DocTable): Partial<Record<StatementColumnKind, string>> => {
    const map: Partial<Record<StatementColumnKind, string>> = {};
    for (const header of table.headers) {
      const kind = classify(header);
      if (kind && !map[kind]) map[kind] = header;
    }
    return map;
  };

  const tableColumns = found.map(columnsOf);
  if (!tableColumns.some((c) => c.date)) {
    warnings.push("Couldn't find a date column — check the statement layout.");
  }
  if (!tableColumns.some((c) => c.balance)) {
    warnings.push("Couldn't find a balance column — monthly balances can't be derived from this statement.");
  }

  const transactions: ParsedTransaction[] = [];
  found.forEach((table, t) => {
    const columns = tableColumns[t];
    if (!columns.date) return; // not a transaction table

    for (const record of table.records) {
      const get = (kind: StatementColumnKind): string => {
        const header = columns[kind];
        return (header ? record.cells[header] : null) ?? "";
      };

      const rawDate = get("date");
      let date = rawDate ? parseStatementDate(rawDate) : null;
      let description = get("description");

      // A tight layout can leave no more than a word-space between the date
      // and description columns, so reconstruction has no gap to split on and
      // glues them into one cell ("03/04/25 SOME NARRATION"). If the whole
      // field didn't parse as a date, peel a leading date token off it and
      // treat the remainder as the start of the description.
      if (date === null && rawDate) {
        const split = splitLeadingDate(rawDate);
        if (split.date) {
          date = split.date;
          description = split.rest ? [split.rest, description].filter(Boolean).join(" ") : description;
        }
      }

      // Parsed, not merely present: an unrelated row's text can land inside a
      // column's tolerance without being a number, and a presence-only check
      // would treat that as a movement on the strength of garbage.
      const debit = parseAmount(get("debit"));
      const credit = parseAmount(get("credit"));
      const balance = parseAmount(get("balance"));

      // A transaction always carries its own date. A row without one is never
      // a new entry — most often a wrapped reference fragment whose trailing
      // digits happened to land in an amount column, which is exactly how a
      // phantom transaction with a bogus amount used to appear while the real
      // dated transaction above it lost its own figure to the same
      // misalignment. Any amount matched on an undated row is ignored.
      if (date === null) continue;

      // Dated, but with no movement — an "Opening Balance"/"Closing Balance"
      // marker restated with a date. Not a transaction.
      if (debit === null && credit === null) continue;

      transactions.push({ date, rawDate, description, debit, credit, balance });
    }
  });

  if (transactions.length === 0) {
    warnings.push(
      "No transaction rows were recognized in this document — its columns didn't match the expected " +
        "date/description/debit/credit/balance layout. Review the parsed document below and adjust the " +
        "account/monthly balances manually.",
    );
  }

  return { transactions, warnings, templateApplied: applied() };
}

/** Derives one month-end balance per month covered, from the last dated
 *  transaction (by date, then document order) that has a balance value. */
export function monthlyBalancesFromTransactions(transactions: ParsedTransaction[]): MonthlyBalance[] {
  const byMonth = new Map<string, MonthlyBalance>();
  for (const t of transactions) {
    if (!t.date || t.balance === null) continue;
    const month = t.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (!existing || t.date >= existing.asOfDate) {
      byMonth.set(month, { month, balance: t.balance, asOfDate: t.date });
    }
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export interface PreviewPdfStatementOptions {
  /** Account name to match/create — the statement itself rarely states this
   *  unambiguously enough to auto-detect, so the caller (the import page) asks
   *  the user to confirm it, same as Excel import's account-name matching. */
  accountName: string;
  passwordCandidates: string[];
  /** The selected account's institution, if any — used to look up a
   *  per-institution column template (`institutionTemplates.ts`). Optional:
   *  a brand-new account with no institution set just uses the generic
   *  column-detection heuristic, same as before this existed. */
  institution?: string | null;
}

/** Reads a bank/credit-card statement — PDF, password-protected ZIP, or
 *  xlsx/xls — and produces a review-ready preview. Does not write to the
 *  database — pair with `commitPdfStatement`. */
export async function previewPdfStatement(
  bytes: Uint8Array,
  filename: string,
  opts: PreviewPdfStatementOptions,
): Promise<StatementPreview> {
  const log = createParseLog();
  const opened = await openDocument(bytes, filename, opts.passwordCandidates, log, STATEMENT_DOC_OPTIONS);

  const { transactions, warnings, templateApplied } = parseTransactionsFromDoc(opened.model, opts.institution);
  if (templateApplied) log.log("column-detection", `using ${opts.institution} statement template`);
  const monthlyBalances = monthlyBalancesFromTransactions(transactions);

  const accounts = await listAccounts({ includeArchived: true });
  const matched = accounts.find((a) => normalize(a.name) === normalize(opts.accountName));

  if (monthlyBalances.length === 0 && transactions.length > 0) {
    warnings.push("Found transactions but no usable (date, balance) pairs — nothing to commit yet.");
  }

  void writeDebugDump("bank-statement", {
    filename,
    accountName: opts.accountName,
    passwordUsed: opened.passwordUsed,
    model: opened.model,
    positional: opened.positional,
    transactions,
    monthlyBalances,
    warnings,
    log: opened.log,
  });

  return {
    accountName: opts.accountName,
    matchedAccountId: matched?.id ?? null,
    sourceFile: filename,
    transactions,
    monthlyBalances,
    warnings,
    passwordUsed: opened.passwordUsed,
    log: opened.log,
    model: opened.model,
  };
}

export interface PdfStatementCommitResult extends CommitResult {
  /** Rows written to the per-account transaction ledger (desktop-only feature).
   *  0 when the statement had no recognized transaction rows. */
  transactionsWritten: number;
  /** The account the statement's balances/transactions were written to (matched or newly created). */
  accountId: number | null;
}

/**
 * Commits a statement's monthly balances by reusing the Excel importer's
 * account-matching + ledger/zero-fill commit pipeline (`commitImport`) — a PDF
 * statement writes the same kind of `myfinance_monthly_snapshot` rows an Excel
 * import would, one per month covered. It ALSO persists the underlying
 * transaction rows to the per-account ledger (`myfinance_transactions`,
 * desktop-only) — `commitImport` only resolves/creates the account as a side
 * effect of writing snapshots, so the account id is re-resolved by name here
 * once that's done, then every parsed transaction is written tagged with this
 * exact file as its `source_path`, replacing any earlier import of the same
 * file for the same account (see `replaceTransactionsForSource`).
 */
export async function commitPdfStatement(preview: StatementPreview, opts: CommitOptions): Promise<PdfStatementCommitResult> {
  const previews: SheetPreview[] = preview.monthlyBalances.map((mb) => ({
    sheetName: preview.accountName,
    month: mb.month,
    rows: [
      {
        item: preview.accountName,
        value: mb.balance,
        kind: "balance",
        matchedAccountId: preview.matchedAccountId,
      },
    ],
    errors: [],
  }));

  const result = await commitImport(previews, opts);

  const accounts = await listAccounts({ includeArchived: true });
  const acct = accounts.find((a) => normalize(a.name) === normalize(preview.accountName));

  let transactionsWritten = 0;
  if (preview.transactions.length > 0 && acct) {
    transactionsWritten = await replaceTransactionsForSource(
      acct.id,
      `STATEMENT:${preview.sourceFile}`,
      preview.transactions.map((t) => ({
        date: t.date,
        raw_date: t.rawDate,
        description: t.description,
        debit: t.debit,
        credit: t.credit,
        balance: t.balance,
      })),
    );
  }

  return { ...result, transactionsWritten, accountId: acct?.id ?? null };
}
