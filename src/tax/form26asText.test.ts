/**
 * Form 26AS's caret-delimited "Text" export (issued instead of a PDF once a
 * taxpayer has over 1000 entries).
 *
 * There is no format-specific parser any more: the delimited text becomes the
 * same `DocModel` a PDF does — its leading empty field is what nests each
 * deductor's per-transaction table — and `parseTdsDoc` reads both. This file
 * keeps the format's own fixtures and assertions so that equivalence stays
 * proven rather than assumed.
 */
import { describe, expect, it } from "vitest";
import { buildDocModel, detectDelimiter, fromDelimitedText, GRID_INDENT_TOLERANCE } from "@scandoc/core/docmodel";
import { parseTdsDoc } from "./tdsTablePdf";
import { extractForm26asHeader } from "./form26asHeader";
import { parseAmount } from "@/statements/amount";
import { parseStatementDate } from "@/statements/parseDate";

function parseForm26asText(text: string) {
  const model = buildDocModel(
    { doc: fromDelimitedText(text), filename: "26AS.txt", kind: "txt" },
    { parseNumber: parseAmount, parseDate: parseStatementDate, indentTolerance: GRID_INDENT_TOLERANCE },
  );
  return { ...parseTdsDoc(model), header: extractForm26asHeader(model) };
}

const SAMPLE = [
  "^Annual Tax Statement^",
  "",
  "File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee^Address Line 1^Address Line 2^Address Line 3^Address Line 4^Address Line 5^Statecode^Pin Code",
  "17-02-2023^AAAPA0000A^ACTIVE^2022-2023^2023-2024^SAMPLE TAXPAYER^EXAMPLE STREET^LINE TWO^EXAMPLE LANDMARK^EXAMPLE AREA^EXAMPLE CITY^EXAMPLE STATE^000000",
  "",
  "^PART-I - Details of Tax Deducted at Source^",
  "Sr. No.^Name of Deductor^TAN of Deductor^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)",
  "1^FIRST DEDUCTOR PVT LTD^BLRE00005E^^^^100000.00^0.00^0.00",
  "^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)",
  "^1^192^30-Dec-2022^F^28-Jan-2023^-^25000.00^0.00^0.00",
  "^2^192^30-Nov-2022^F^28-Jan-2023^-^25000.00^0.00^0.00",
  "2^ACME BANK LTD^ACME01234B^^^^60000.00^6000.00^6000.00",
  "^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)",
  "^1^194A^15-Jun-2022^F^28-Jul-2022^-^60000.00^6000.00^6000.00",
  "",
  "^PART-II - Details of Tax Deducted at Source for 15G / 15H^",
  "Sr. No.^Name of Deductor^TAN of Deductor^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)",
  "^^^************** No Transactions Present ***********^",
].join("\n");

describe("detectDelimiter", () => {
  it("picks the caret used by the real TRACES export", () => {
    expect(detectDelimiter(SAMPLE)).toBe("^");
  });

  it("adapts to a different delimiter when that's what actually appears", () => {
    const pipeVariant = SAMPLE.replace(/\^/g, "|");
    expect(detectDelimiter(pipeVariant)).toBe("|");
  });

  it("doesn't get fooled by commas inside Indian-grouped amounts", () => {
    expect(detectDelimiter("Amount^12,34,567.00^Next^Field")).toBe("^");
  });

  it("reports no delimiter rather than guessing when the text has none", () => {
    // The previous format-specific parser defaulted to caret here. Reporting
    // null is equivalent downstream — either way the line stays whole — and
    // is honest about having found nothing.
    expect(detectDelimiter("plain text with no delimiters")).toBeNull();
  });
});

describe("parseForm26asText", () => {
  it("reads PAN and Assessment Year from the metadata header/data line pair", () => {
    const { header } = parseForm26asText(SAMPLE);
    expect(header).toEqual({ pan: "AAAPA0000A", assessmentYear: "2023-2024" });
  });

  it("extracts the outer deductor-summary rows from Part I, with the embedded per-transaction sub-table nested onto each one", () => {
    const { rows } = parseForm26asText(SAMPLE);
    expect(rows).toEqual([
      {
        deductorName: "FIRST DEDUCTOR PVT LTD",
        tan: "BLRE00005E",
        amountPaid: 100000,
        taxDeducted: 0,
        transactions: [
          { section: "192", transactionDate: "2022-12-30", dateOfBooking: "2023-01-28", status: "F", amountPaid: 25000, taxDeducted: 0 },
          { section: "192", transactionDate: "2022-11-30", dateOfBooking: "2023-01-28", status: "F", amountPaid: 25000, taxDeducted: 0 },
        ],
      },
      {
        deductorName: "ACME BANK LTD",
        tan: "ACME01234B",
        amountPaid: 60000,
        taxDeducted: 6000,
        transactions: [
          { section: "194A", transactionDate: "2022-06-15", dateOfBooking: "2022-07-28", status: "F", amountPaid: 60000, taxDeducted: 6000 },
        ],
      },
    ]);
  });

  it("stops at PART-II and doesn't pick up its (empty) content as Part I rows", () => {
    const { rows } = parseForm26asText(SAMPLE);
    expect(rows).toHaveLength(2);
  });

  it("doesn't warn about unclaimed per-transaction detail when it was successfully captured", () => {
    const { warnings } = parseForm26asText(SAMPLE);
    expect(warnings.some((w) => /per-transaction detail/i.test(w))).toBe(false);
  });

  it("warns about per-transaction detail it couldn't attribute to a deductor (e.g. appearing before any deductor row)", () => {
    const orphan = [
      "^PART-I - Details of Tax Deducted at Source^",
      "Sr. No.^Name of Deductor^TAN of Deductor^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)",
      "^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)",
      "^1^192^30-Dec-2022^F^28-Jan-2023^-^25000.00^0.00^0.00",
    ].join("\n");
    const { warnings } = parseForm26asText(orphan);
    expect(warnings.some((w) => /per-transaction detail/i.test(w))).toBe(true);
  });

  it("adapts to a non-default delimiter end-to-end", () => {
    const pipeVariant = SAMPLE.replace(/\^/g, "|");
    const { header, rows } = parseForm26asText(pipeVariant);
    expect(header.pan).toBe("AAAPA0000A");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ deductorName: "FIRST DEDUCTOR PVT LTD", amountPaid: 100000 });
  });

  it("warns and returns no rows when PART-I can't be found at all", () => {
    const { rows, warnings } = parseForm26asText("^Annual Tax Statement^\nsome unrelated content");
    expect(rows).toEqual([]);
    expect(warnings.some((w) => /PART-I/.test(w))).toBe(true);
  });

  it("returns no rows (with the generic warning) when Part I explicitly has no transactions", () => {
    const noTx = [
      "^PART-I - Details of Tax Deducted at Source^",
      "Sr. No.^Name of Deductor^TAN of Deductor^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)",
      "^^^************** No Transactions Present ***********^",
      "",
      "^PART-II - Details of Tax Deducted at Source for 15G / 15H^",
    ].join("\n");
    const { rows, warnings } = parseForm26asText(noTx);
    expect(rows).toEqual([]);
    expect(warnings).toContain("No TDS rows were recognized in this document.");
    // The sentinel line itself starts with a delimiter too — must not be
    // miscounted as real embedded per-transaction detail that was skipped.
    expect(warnings.some((w) => /per-transaction detail/i.test(w))).toBe(false);
  });
});
