import { describe, expect, it } from "vitest";
import { buildDocModel, fromNativeRows } from "@scandoc/core/docmodel";
import { STATEMENT_DOC_OPTIONS, parseTransactionsFromDoc } from "./pdfStatementImport";
import { parseAmount } from "./amount";
import { parseStatementDate } from "./parseDate";
import { sheetToTableRows } from "./sheetAdapter";
import type { SheetRaw } from "@/excel/types";

describe("sheetToTableRows", () => {
  it("gives each column a distinct, well-separated x slot", () => {
    const sheet: SheetRaw = {
      name: "Statement",
      rows: [
        ["Date", "Description", "Debit", "Credit", "Balance"],
        ["01/04/2026", "Salary credit", null, 50000, 50000],
      ],
    };

    const rows = sheetToTableRows(sheet, 0);

    expect(rows[0].cells.map((c) => c.text)).toEqual(["Date", "Description", "Debit", "Credit", "Balance"]);
    // The null Debit cell for row 1 is dropped, not emitted as an empty cell.
    expect(rows[1].cells.map((c) => c.text)).toEqual(["01/04/2026", "Salary credit", "50000", "50000"]);
  });

  it("feeds cleanly into the existing PDF-oriented transaction parser", () => {
    const sheet: SheetRaw = {
      name: "Statement",
      rows: [
        ["Date", "Description", "Debit", "Credit", "Balance"],
        ["01/04/2026", "Salary credit", null, 50000, 50000],
        ["02/04/2026", "ATM withdrawal", 2000, null, 48000],
      ],
    };

    const model = buildDocModel(
      { doc: fromNativeRows(sheetToTableRows(sheet, 0)), filename: "statement.xlsx", kind: "xlsx" },
      { parseNumber: parseAmount, parseDate: parseStatementDate, ...STATEMENT_DOC_OPTIONS },
    );
    const { transactions, warnings } = parseTransactionsFromDoc(model);

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({ date: "2026-04-01", credit: 50000, balance: 50000 });
    expect(transactions[1]).toMatchObject({ date: "2026-04-02", debit: 2000, balance: 48000 });
  });
});
