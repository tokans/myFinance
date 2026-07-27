/**
 * What the review screen should show as "captured".
 *
 * `ParsedDocumentPanel` highlights, in the parsed document, every value that
 * made it into the data being saved — so what it is handed decides what a
 * reviewer believes the import understood. Handing it a subset is not a
 * cosmetic bug: an AIS export states each category TWICE, a summary table and
 * a per-source table below it (who paid, and per transaction the date,
 * amount, TDS withheld and Active/Inactive status), plus the Part B2 SFT
 * entries. All of that IS captured — it becomes the payer-tagged TDS/TCS
 * payment rows and the SFT cross-check rows on commit — but the panel used to
 * be told only about the category summary, so every figure in the secondary
 * tables rendered unhighlighted and the import looked like it had ignored
 * half the document.
 */
import type { CategoryAmountParseResult } from "./categoryAmountPdf";

/** The shape both AIS and TIS results share, plus AIS's extra source detail.
 *  Structural on purpose — this only needs to know that a `warnings` list
 *  exists at each level, not what else either result carries. */
export type CategoryDocumentResult = CategoryAmountParseResult & {
  sourceDetail?: { warnings: string[] };
};

/**
 * Strips only `warnings`, at both levels.
 *
 * Warnings are prose ABOUT the parse rather than anything read out of the
 * document, and the panel matches captured strings against the rendered text
 * by substring — so leaving them in highlights arbitrary words wherever a
 * warning happens to quote the document.
 */
export function capturedOf(parsed: CategoryDocumentResult): unknown {
  const { warnings: _warnings, ...rest } = parsed;
  if (rest.sourceDetail) {
    const { warnings: _sourceWarnings, ...sourceDetail } = rest.sourceDetail;
    return { ...rest, sourceDetail };
  }
  return rest;
}
