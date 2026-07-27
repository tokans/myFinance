/**
 * myFinance's binding of the shared document pipeline.
 *
 * The mechanism now lives in two app-agnostic packages — `sharedcorelib/
 * docintake` (what is this file, how do I open it) and `@scandoc/core/
 * docmodel` (what shape is it) — and this module supplies only what is
 * genuinely local: the Tauri-backed native seams, India-specific amount and
 * date recognition, and the mobile capability gate.
 *
 * TWO ENTRY POINTS, on purpose, while the migration is in flight:
 *   - `openProtectedDocument` keeps returning geometry-flavoured rows/sheets,
 *     so the ~20 existing domain parsers work untouched;
 *   - `openDocument` returns a positionless `DocModel`, which is what new and
 *     migrated parsers read.
 * Both run the SAME intake, so a document opens identically either way and
 * there is no window where one path is fixed and the other isn't.
 */
import { createDocIntake, type Extraction, type IntakeResult } from "sharedcorelib/docintake";
import {
  buildDocModel,
  fromExtraction,
  indentToleranceFor,
  type DocModel,
  type DocModelOptions,
  type PositionalDoc,
} from "@scandoc/core/docmodel";
import type { SheetRaw } from "@/excel/types";
import { isMobile } from "@/lib/environment";
import type { ParseLog } from "@/lib/parseLog";
import { createParseLog } from "@/lib/parseLog";
import { extractZipEntry } from "./archiveInvoke";
import { parseStatementPdf } from "./pdfInvoke";
import { parseAmount } from "./amount";
import { parseStatementDate } from "./parseDate";
import { sheetsToTableRows } from "./sheetAdapter";
import { MobileUnsupportedError, NativeCapabilityError, type PdfTableRow } from "./types";

/**
 * PDFium and the zip reader are bundled as desktop Tauri resources only, so
 * on mobile those seams are simply not supplied and the intake refuses a
 * PDF/ZIP up front. The xlsx/xls path is pure JS and stays available, which
 * is why this is decided per-seam rather than once for the whole intake.
 */
async function createIntake() {
  const mobile = await isMobile();
  return createDocIntake({
    parsePdf: mobile ? undefined : parseStatementPdf,
    extractZip: mobile ? undefined : extractZipEntry,
  });
}

/** The intake reports a missing seam generically; only this layer knows the
 *  seam is missing *because the user is on mobile*, so it owns the message. */
function rethrowCapability(err: unknown): never {
  if (err instanceof NativeCapabilityError) throw new MobileUnsupportedError();
  throw err;
}

async function runIntake(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
  log: ParseLog,
): Promise<IntakeResult> {
  const intake = await createIntake();
  try {
    return await intake.open(bytes, filename, passwordCandidates, log);
  } catch (err) {
    return rethrowCapability(err);
  }
}

/** Amount and date recognition are locale-specific, so the structuring engine
 *  takes them as inputs. It only ever asks "is this cell data-shaped?" — the
 *  parsed values are discarded, and the model carries the original text. */
function docModelOptions(extraction: Extraction, overrides?: DocModelOverrides): DocModelOptions {
  return {
    parseNumber: parseAmount,
    parseDate: parseStatementDate,
    indentTolerance: indentToleranceFor(extraction),
    ...overrides,
  };
}

/**
 * Per-document-type structuring tweaks. Amount/date recognition is shared by
 * everything this app reads, but the rest genuinely varies by issuer: AIS
 * needs its templated page footer stripped and its ALL-CAPS sub-table headers
 * kept out of category labels, a CA's computation sheet needs indent-based
 * section nesting. Defaults suit a plain tabular document.
 */
export type DocModelOverrides = Partial<Omit<DocModelOptions, "parseNumber" | "parseDate">>;

export interface OpenedDocument {
  model: DocModel;
  /** The interim geometry, for the diagnostic dump only. Domain code must map
   *  off `model`; reaching in here re-creates the coupling this pipeline
   *  exists to remove. */
  positional: PositionalDoc;
  passwordUsed: string | null;
  log: IntakeResult["log"];
}

/** Opens a document and structures it. The entry point for migrated parsers. */
export async function openDocument(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
  log: ParseLog = createParseLog(),
  overrides?: DocModelOverrides,
): Promise<OpenedDocument> {
  const opened = await runIntake(bytes, filename, passwordCandidates, log);
  const positional = fromExtraction(opened.extraction);
  const model = buildDocModel(
    { doc: positional, filename: opened.filename, kind: opened.sourceKind },
    docModelOptions(opened.extraction, overrides),
  );
  log.log("structure", `${model.children.length} top-level node(s); ${model.warnings.length} structural warning(s)`);
  return { model, positional, passwordUsed: opened.passwordUsed, log: log.entries };
}

/**
 * Structures already-extracted rows, for a document whose parsing is only
 * PARTLY migrated: AIS reads its category summary from the model while its
 * source-detail sub-parser still works off geometry, and both must see the
 * same extraction. Also what the parser tests use, so a test and its import
 * page structure a document identically — the two disagreeing is the one
 * failure mode that would be invisible in both.
 *
 * Transitional. Once every sub-parser of a document type is migrated, its
 * caller uses `openDocument` and this goes away.
 */
export function modelFromTableRows(
  rows: PdfTableRow[],
  filename: string,
  overrides?: DocModelOverrides,
): DocModel {
  const extraction: Extraction = { kind: "pdf", rows };
  return buildDocModel(
    { doc: fromExtraction(extraction), filename, kind: "pdf" },
    docModelOptions(extraction, overrides),
  );
}

// ── Legacy surface ──────────────────────────────────────────────────────────
// Everything below preserves the pre-DocModel shape so unmigrated parsers keep
// working. It disappears once the last one is migrated.

export type DocumentIntakeResult =
  | { kind: "pdf"; rows: PdfTableRow[]; passwordUsed: string | null; log: IntakeResult["log"] }
  | { kind: "workbook"; sheets: SheetRaw[]; passwordUsed: string | null; log: IntakeResult["log"] }
  | { kind: "text"; text: string; passwordUsed: string | null; log: IntakeResult["log"] };

export async function openProtectedDocument(
  bytes: Uint8Array,
  filename: string,
  passwordCandidates: string[],
  log: ParseLog = createParseLog(),
): Promise<DocumentIntakeResult> {
  const opened = await runIntake(bytes, filename, passwordCandidates, log);
  const { extraction, passwordUsed } = opened;

  if (extraction.kind === "pdf") {
    return { kind: "pdf", rows: extraction.rows, passwordUsed, log: opened.log };
  }
  if (extraction.kind === "grid") {
    // `formulas` stays empty: it is only consumed by the myFinance-workbook
    // import path (`excel/formulas.ts`), never by a document parser, so the
    // intake layer doesn't carry it.
    const sheets: SheetRaw[] = extraction.grids.map((g) => ({ name: g.name, rows: g.rows, formulas: [] }));
    return { kind: "workbook", sheets, passwordUsed, log: opened.log };
  }
  return { kind: "text", text: extraction.text, passwordUsed, log: opened.log };
}

/**
 * Narrows a legacy result to reconstructed table rows, for the parsers that
 * don't understand plain text — only Form 26AS's text export handles that
 * itself. Throws a clear error rather than a type error if some other import
 * page is handed a `.txt`.
 */
export function tableRowsFrom(opened: DocumentIntakeResult, filename: string): PdfTableRow[] {
  if (opened.kind === "text") {
    throw new Error(`Unsupported file type for "${filename}" — expected a PDF or Excel workbook.`);
  }
  return opened.kind === "pdf" ? opened.rows : sheetsToTableRows(opened.sheets);
}
