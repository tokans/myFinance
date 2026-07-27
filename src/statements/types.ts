import type { DocModel } from "@scandoc/core/docmodel";
import type { ParseLogEntry } from "@/lib/parseLog";

/** Mirrors pdf-lib's Rust `TableCell` / `TableRow` (serde-serialized over the Tauri bridge). */
export interface PdfTableCell {
  text: string;
  x: number;
  width: number;
}

export interface PdfTableRow {
  page_index: number;
  row_index: number;
  cells: PdfTableCell[];
}

export interface ParseStatementPdfResult {
  rows: PdfTableRow[];
  /** The candidate password that opened the document, or null if it wasn't encrypted. */
  password_used: string | null;
}

/**
 * Re-exported from `sharedcorelib/docintake`, NOT redeclared here.
 *
 * This has to be the one class the intake layer itself throws and catches: it
 * uses `instanceof` to recognize a password failure at each container layer
 * and attach the log so far. A local class of the same name would fail that
 * check silently, and the only symptom would be a lost diagnostic on exactly
 * the failures the log exists to explain.
 */
export { DocumentPasswordRequiredError, NativeCapabilityError } from "sharedcorelib/docintake";

/** Thrown when a PDF or password-protected ZIP is opened on mobile, where the
 *  Rust/PDFium native parser isn't bundled (desktop-only resource). Plain
 *  password-protected xlsx/xls goes through pure-JS decryption and isn't
 *  affected — see documentIntake.ts's per-branch gating. */
export class MobileUnsupportedError extends Error {
  constructor() {
    super(
      "PDF and password-protected ZIP import isn't available on mobile yet — use the desktop app, " +
        "or upload a plain Excel (.xlsx/.xls) file instead if you have one.",
    );
    this.name = "MobileUnsupportedError";
  }
}

/** Which statement field a reconstructed column represents. */
export type StatementColumnKind = "date" | "description" | "debit" | "credit" | "balance";

export interface ParsedTransaction {
  date: string | null;
  rawDate: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

export interface MonthlyBalance {
  month: string;
  /** Balance as of the last transaction seen in that month. */
  balance: number;
  asOfDate: string;
}

export interface StatementPreview {
  accountName: string;
  matchedAccountId: number | null;
  /** Original filename — becomes the `source_path` ("STATEMENT:<sourceFile>") every
   *  persisted transaction row is tagged with, so a re-import of the same file can
   *  safely replace its own rows without touching a differently-named import. */
  sourceFile: string;
  transactions: ParsedTransaction[];
  monthlyBalances: MonthlyBalance[];
  warnings: string[];
  /** The password that opened this document, if any — the review screen
   *  offers to remember it (see `@/lib/documentPasswordVault`). */
  passwordUsed: string | null;
  log: ParseLogEntry[];
  /** The structured document, shown in the review screen so the user can see
   *  everything the parser read — not only what it understood. */
  model: DocModel;
}
