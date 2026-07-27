import { describe, expect, it } from "vitest";
import {
  CAPITAL_GAINS_DOC_OPTIONS, capitalGainsPdfToIncomeRows, parseCapitalGainsStatement,
  type CapitalGainsTemplate,
} from "./capitalGainsPdf";
import { modelFromTableRows } from "@/statements/documentIntake";
import type { PdfTableRow } from "@/statements/types";

function row(rowIndex: number, cells: [string, number][]): PdfTableRow {
  return {
    page_index: 0,
    row_index: rowIndex,
    cells: cells.map(([text, x]) => ({ text, x, width: 20 })),
  };
}

/** These fixtures stay geometry, deliberately: they are the real layouts this
 *  parser was hardened against, and routing them through the same structuring
 *  the import page uses keeps them guarding the whole path rather than just
 *  the scan. */
function doc(rows: PdfTableRow[]) {
  return modelFromTableRows(rows, "capital-gains.pdf", CAPITAL_GAINS_DOC_OPTIONS);
}
const EMPTY_MODEL = doc([]);

describe("parseCapitalGainsStatement", () => {
  it("reads short/long term totals from separate label/amount cells on the same row", () => {
    const rows = [
      row(0, [["Short Term Capital Gains", 10], ["1,25,000.00", 300]]),
      row(1, [["Long Term Capital Gains", 10], ["3,40,500.00", 300]]),
    ];

    const result = parseCapitalGainsStatement(doc(rows));

    expect(result.shortTerm).toBe(125000);
    expect(result.longTerm).toBe(340500);
    expect(result.warnings).toEqual([]);
  });

  it("reads a total glued into the same cell as the label", () => {
    const rows = [
      row(0, [["Total Short Term Capital Gain 1,25,000.00", 10]]),
      row(1, [["Total Long Term Capital Gain 3,40,500.00", 10]]),
    ];

    const result = parseCapitalGainsStatement(doc(rows));

    expect(result.shortTerm).toBe(125000);
    expect(result.longTerm).toBe(340500);
  });

  it("prefers a 'total' line over a per-scrip row that happens to repeat the same wording", () => {
    const rows = [
      row(0, [["Short Term Capital Gain on RELIANCE", 10], ["5,000.00", 300]]),
      row(1, [["Total Short Term Capital Gain", 10], ["1,25,000.00", 300]]),
    ];

    const result = parseCapitalGainsStatement(doc(rows));

    expect(result.shortTerm).toBe(125000);
  });

  it("falls back to the category/amount table shape when no label:value prose is found", () => {
    const rows = [
      row(0, [["Category", 10], ["Amount", 300]]),
      row(1, [["Short Term Capital Gain", 10], ["1,25,000.00", 300]]),
      row(2, [["Long Term Capital Gain", 10], ["3,40,500.00", 300]]),
    ];

    const result = parseCapitalGainsStatement(doc(rows));

    expect(result.shortTerm).toBe(125000);
    expect(result.longTerm).toBe(340500);
  });

  it("warns and leaves a total null when only one term is present in the document", () => {
    const rows = [row(0, [["Short Term Capital Gains", 10], ["1,25,000.00", 300]])];

    const result = parseCapitalGainsStatement(doc(rows));

    expect(result.shortTerm).toBe(125000);
    expect(result.longTerm).toBeNull();
    expect(result.warnings.some((w) => w.includes("long-term"))).toBe(true);
  });

  it("always carries the full document for reference, not just the two totals it extracted", () => {
    const rows = [
      row(0, [["Short Term Capital Gains", 10], ["1,25,000.00", 300]]),
      row(1, [["RELIANCE", 10], ["INE002A01018", 150], ["12/05/2025", 300]]),
    ];
    const result = parseCapitalGainsStatement(doc(rows));

    // The per-scrip detail this parser does not extract still has to survive
    // into the review panel, or a wrong total cannot be checked against it.
    expect(JSON.stringify(result.model)).toContain("INE002A01018");
  });

  it("prefers a matching institution template's own pattern over the generic scan", () => {
    const rows = [row(0, [["STCG Summary: 99,999.00 | LTCG Summary: 88,888.00", 10]])];
    const template: CapitalGainsTemplate = {
      institution: "Test Broker",
      shortTermPattern: /STCG Summary:\s*([\d,]+\.?\d*)/i,
      longTermPattern: /LTCG Summary:\s*([\d,]+\.?\d*)/i,
    };
    // Templates registry is architecture-only (empty) right now, so exercise the
    // matching function directly rather than via the (currently empty) registry.
    const short = template.shortTermPattern!.exec(rows[0].cells[0].text);
    expect(short?.[1]).toBe("99,999.00");
    // parseCapitalGainsStatement itself still falls back to the generic scan
    // for an institution with no registered template — proves it's additive.
    const result = parseCapitalGainsStatement(doc(rows), "Test Broker");
    expect(result.shortTerm).toBeNull(); // generic scan finds no "capital gain" wording here
  });
});

describe("capitalGainsPdfToIncomeRows", () => {
  it("emits both heads when both totals are present", () => {
    const income = capitalGainsPdfToIncomeRows({ shortTerm: 125000, longTerm: 340500, warnings: [], model: EMPTY_MODEL }, "AY2026-27");
    expect(income).toEqual([
      expect.objectContaining({ ay: "AY2026-27", head: "cg_short", amount: 125000, source_path: "CapitalGains-PDF" }),
      expect.objectContaining({ ay: "AY2026-27", head: "cg_long", amount: 340500, source_path: "CapitalGains-PDF" }),
    ]);
  });

  it("emits nothing for a null or zero total", () => {
    expect(capitalGainsPdfToIncomeRows({ shortTerm: null, longTerm: 0, warnings: [], model: EMPTY_MODEL }, "AY2026-27")).toEqual([]);
  });

  it("emits only the term that was found", () => {
    const income = capitalGainsPdfToIncomeRows({ shortTerm: 125000, longTerm: null, warnings: [], model: EMPTY_MODEL }, "AY2026-27");
    expect(income).toHaveLength(1);
    expect(income[0].head).toBe("cg_short");
  });
});
