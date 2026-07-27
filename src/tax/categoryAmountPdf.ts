/**
 * AIS / TIS PDF: the per-category summary table, plus the two differently
 * shaped sections (advance-tax challans, refunds) those exports also carry.
 *
 * This reads a structured `DocModel` — sections, tables keyed by their own
 * headers — rather than positional rows. That deletes most of what this file
 * used to be: header-row scoring, x-position column snapping, wrapped-label
 * folding with a fold cap, page-footer stripping, and two structural
 * "anchor token" scans that existed only because the generic header
 * classifier could not see Part B3/B4's tables at all (their headers contain
 * no category/amount vocabulary, so those sections' rows used to be silently
 * dropped or mis-attributed to whichever segment preceded them). A section
 * heading is now just a section, and a table is just a table.
 *
 * Still a lighter, less precise read than the AIS Utility's structured JSON
 * export (`aisParser.ts`); real AIS/TIS PDF layouts vary more than the JSON
 * schema does, so treat it as a starting point requiring review.
 */
import { cellByPattern, tables, walkWithPath, type DocModel, type DocTable } from "@scandoc/core/docmodel";
import type { DocModelOverrides } from "@/statements/documentIntake";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

export type CategoryAmountColumnKind = "category" | "amount";

const CATEGORY_WORDS = /\b(information category|category|description|particulars|nature of transaction)\b/i;
// "accepted by" recognizes TIS's "Accepted by Taxpayer/Confirmed by Source"
// column — the one TIS's own disclaimer names as the settled value.
// Deliberately does NOT match "processed by", the interim value column printed
// beside it: matching both would pull two different figures for one category.
const AMOUNT_WORDS = /\b(amount|value|gross amount|amount reported|accepted by)\b/i;

export function classifyHeaderCell(text: string): CategoryAmountColumnKind | null {
  const t = text.trim();
  if (!t) return null;
  if (CATEGORY_WORDS.test(t)) return "category";
  if (AMOUNT_WORDS.test(t)) return "amount";
  return null;
}

/**
 * AIS/TIS print this at every page break, frequently glued onto whatever real
 * cell renders there (a category label becomes "Salary (TDS Annexure II)
 * Download ID : ... Page 6 of 7"). It changes every time — page number,
 * timestamp — so verbatim-repeat detection can never catch it; only a pattern
 * strip can.
 *
 * One pattern per FIELD, not one for the whole footer. Strips run per cell,
 * and whether the footer arrives as one glued cell or as four separate ones is
 * a property of how that page happened to render: a real export lays it out as
 * `Download ID : … | IP Address : …` on one row and `Generation Date : … |
 * Page 2 of 7` on the next. A single pattern spanning all four fields matches
 * the glued form only, so on that document the whole footer survived — landing
 * in the model as table headers carrying the filer's PAN and IP address, into
 * the review panel and the diagnostic dump alike. Per-field patterns catch
 * both layouts, since the glued cell is simply all four in sequence.
 */
const PAGE_FOOTER: RegExp[] = [
  /download id\s*:\s*\S+/gi,
  /ip address\s*:\s*\S+/gi,
  /generation date\s*:\s*[\d/]+,?\s*[\d:]*/gi,
  /page\s*\d+\s*of\s*\d+/gi,
];

/** A bare leading "<n> " glued onto a category label, which happens when a
 *  table's SR.No. column sits inside the same wide header span as its
 *  category column (TIS's summary table glues "SR. NO. INFORMATION CATEGORY"
 *  into one header cell, so both values snap into it). No real AIS/TIS
 *  category name begins with a digit run, so this is safe unconditionally. */
const LEADING_SR_NO = /^\d{1,3}\s+(?=[A-Za-z])/;

function cleanCategoryText(text: string): string {
  return PAGE_FOOTER.reduce((s, p) => s.replace(p, ""), text).replace(LEADING_SR_NO, "").trim();
}

/**
 * Text with no lowercase letters at all. The compliance portal writes real
 * category names in sentence case ("Salary received (Section 192)"), while a
 * nested "Information Source-wise Details" sub-table's headers ("ACCOUNT
 * NUMBER", "DATE OF PAYMENT/CREDIT") and its values (bare dates, client IDs)
 * are always ALL CAPS or purely numeric. AIS interleaves those sub-tables
 * under each category with no section marker of their own, so this shape is
 * the only reliable way to tell them apart.
 */
export function isDetailTableNoise(text: string): boolean {
  return !/[a-z]/.test(text);
}

/** Sections whose tables restate figures captured elsewhere. Reading them
 *  would double-count: AIS's SFT section reports the same dividends/interest
 *  as the TDS section above it (and is read source-level by
 *  `aisSourceDetailPdf.ts` instead), Part B7 restates Part B1 verbatim under
 *  an "Annexure" label, and TIS's annexure re-derives its own summary totals
 *  through a denser per-payer breakdown. */
const RESTATED_SECTIONS =
  /specified financial transaction|any other information|annexure to|information details under each information category is provided/i;
const CHALLAN_SECTION = /^part\s*b3\b/i;
const REFUND_SECTION = /^part\s*b4\b/i;

/** A bare "YYYY-YY" financial-year token — the one column every challan and
 *  refund row reliably carries, unlike the surrounding text columns whose
 *  wording varies. */
const FY_TOKEN = /^\d{4}-\d{2}$/;

/** Part B4 glues "REFUND AMOUNT" and "DATE OF PAYMENT" into one cell in this
 *  layout (e.g. "15,840 19/11/2025") — the same tight-column-gap phenomenon
 *  that produces a glued LEADING date elsewhere, mirrored for a trailing one. */
const AMOUNT_THEN_DATE = /^([\d,]+(?:\.\d+)?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})$/;

export interface CategoryAmountRow {
  category: string;
  amount: number | null;
}

/** One advance/self-assessment tax challan from "Part B3 - Information
 *  relating to payment of taxes". */
export interface ChallanRow {
  amount: number;
  date: string | null;
}

/** One refund from "Part B4 - Information relating to demand and refund". */
export interface RefundRow {
  mode: string | null;
  nature: string;
  amount: number;
  date: string | null;
}

export interface CategoryAmountParseResult {
  rows: CategoryAmountRow[];
  paymentRows: ChallanRow[];
  refundRows: RefundRow[];
  warnings: string[];
}

/**
 * Structuring options this document type needs beyond the app defaults.
 * Exported so the import page and the tests build the model identically —
 * a parser and its caller disagreeing about how the document was structured
 * is the one failure mode that would be invisible in both.
 */
export const CATEGORY_AMOUNT_DOC_OPTIONS: DocModelOverrides = {
  stripPatterns: PAGE_FOOTER,
  continuation: (text) => {
    // TIS's annexure banner genuinely ends the summary table. It has to be a
    // break rather than a skip: the annexure restates the SAME totals under a
    // reprint of the same header, so letting the table run on would append
    // every category a second time and double every figure.
    if (RESTATED_SECTIONS.test(text)) return "break";
    // A nested sub-table's ALL-CAPS header is noise inside the table, not the
    // end of it — the next real category row follows it. Folding it would
    // corrupt the category label above; breaking would lose everything after.
    if (isDetailTableNoise(text)) return "skip";
    return "fold";
  },
};

function extractChallans(table: DocTable): ChallanRow[] {
  const rows: ChallanRow[] = [];
  for (const record of table.records) {
    // `parts`, not the header-keyed cells: these tables pack their columns
    // tighter than their header spans, so several printed cells share one
    // column key ("1" and "2025-26" arrive joined as "1 2025-26") and the
    // financial-year anchor is no longer a cell of its own.
    const values = record.parts;
    const fyIndex = values.findIndex((v) => FY_TOKEN.test(v));
    if (fyIndex === -1) continue;

    // "TOTAL (A+B+C+D)" is glued to the BSR code in this layout ("2,00,000
    // 0510002") and never parses as a bare amount. Summing the plain numeric
    // cells between the FY token and the first date is arithmetically the
    // same total and doesn't depend on that cell parsing at all.
    let amount = 0;
    let matched = false;
    let date: string | null = null;
    for (let i = fyIndex + 1; i < values.length; i++) {
      const asDate = parseStatementDate(values[i]);
      if (asDate !== null) {
        date = asDate;
        break;
      }
      const value = parseAmount(values[i]);
      if (value !== null) {
        amount += value;
        matched = true;
      }
    }
    if (matched) rows.push({ amount, date });
  }
  return rows;
}

function extractRefunds(table: DocTable): RefundRow[] {
  const rows: RefundRow[] = [];
  for (const record of table.records) {
    const values = record.parts; // see the note in extractChallans
    const fyIndex = values.findIndex((v) => FY_TOKEN.test(v));
    if (fyIndex === -1) continue;

    const glued = AMOUNT_THEN_DATE.exec(values[values.length - 1] ?? "");
    if (!glued) continue;
    const amount = parseAmount(glued[1]);
    if (amount === null) continue;

    const between = values.slice(fyIndex + 1, values.length - 1);
    const mode = between[0] ?? null;
    rows.push({
      mode,
      nature: between.slice(1).join(" ") || mode || "",
      amount,
      date: parseStatementDate(glued[2]),
    });
  }
  return rows;
}

function isCategoryTable(headers: string[]): boolean {
  return headers.some((h) => classifyHeaderCell(h) === "category");
}

export function parseCategoryAmountDoc(model: DocModel): CategoryAmountParseResult {
  const warnings: string[] = [];
  const rows: CategoryAmountRow[] = [];
  const paymentRows: ChallanRow[] = [];
  const refundRows: RefundRow[] = [];

  let sawCategoryColumn = false;
  let sawAmountColumn = false;
  let detailNoiseDropped = 0;

  for (const { node, path } of walkWithPath(model)) {
    if (node.kind !== "table") continue;
    const section = path.join(" > ");

    if (RESTATED_SECTIONS.test(section)) continue;
    if (CHALLAN_SECTION.test(section) || /payment of taxes/i.test(section)) {
      paymentRows.push(...extractChallans(node));
      continue;
    }
    if (REFUND_SECTION.test(section) || /demand and refund/i.test(section)) {
      refundRows.push(...extractRefunds(node));
      continue;
    }
    if (!isCategoryTable(node.headers)) continue;

    sawCategoryColumn = true;
    const amountHeader = node.headers.find((h) => classifyHeaderCell(h) === "amount");
    if (amountHeader) sawAmountColumn = true;

    for (const record of node.records) {
      const rawCategory = cellByPattern(record, [CATEGORY_WORDS]) ?? "";
      const category = cleanCategoryText(rawCategory);
      const amount = amountHeader ? parseAmount(record.cells[amountHeader] ?? "") : null;

      if (!category && amount === null) continue;
      if (amount === null && isDetailTableNoise(category)) {
        // A nested sub-table's own value row (a bare date, an account number)
        // that reached this table as a record of its own.
        detailNoiseDropped++;
        continue;
      }
      rows.push({ category, amount });
    }
  }

  if (!sawCategoryColumn) {
    warnings.push("Couldn't find an 'Information Category' column — check this is a summary page.");
  }
  if (!sawAmountColumn) {
    warnings.push("Couldn't find an amount column.");
  }
  if (sawCategoryColumn && rows.length === 0) {
    warnings.push("No category/amount rows were recognized in this document — review the parsed document below manually.");
  }
  if (detailNoiseDropped > 0) {
    warnings.push(
      `${detailNoiseDropped} nested source-wise detail row(s) (dates, account numbers, sub-table headers) ` +
        "were not imported — only the category totals above are captured; open the source PDF for the per-source breakdown.",
    );
  }

  return { rows, paymentRows, refundRows, warnings };
}

/** Finds the first table anywhere in the model whose headers satisfy
 *  `match` — used by AIS/TIS callers that need one specific sub-table. */
export function findTableByHeaders(model: DocModel, match: (headers: string[]) => boolean): DocTable | null {
  return tables(model).find((t) => match(t.headers)) ?? null;
}
