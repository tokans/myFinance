import { describe, expect, it } from "vitest";
import { tisPdfToIncomeRows, tisPdfToPaymentRows, tisPdfToRefundRows } from "./tisPdf";

describe("tisPdfToIncomeRows", () => {
  it("maps a dividend category onto a dividend income row", () => {
    const rows = tisPdfToIncomeRows(
      { rows: [{ category: "Dividend", amount: 5000 }], paymentRows: [], refundRows: [], warnings: [] },
      "2026-27",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ay: "2026-27",
      head: "dividend",
      label: "Dividend",
      amount: 5000,
      source_path: "TIS-PDF",
    });
  });

  it("maps a non-dividend category onto other_sources", () => {
    const rows = tisPdfToIncomeRows(
      { rows: [{ category: "Interest from Savings Bank", amount: 12000 }], paymentRows: [], refundRows: [], warnings: [] },
      "2026-27",
    );
    expect(rows[0]).toMatchObject({ head: "other_sources", label: "Interest from Savings Bank" });
  });
});

describe("tisPdfToPaymentRows / tisPdfToRefundRows", () => {
  it("map Part B3/B4 the same way as AIS-PDF, when present", () => {
    const payments = tisPdfToPaymentRows(
      { rows: [], paymentRows: [{ amount: 50000, date: null }], refundRows: [], warnings: [] },
      "2026-27",
    );
    expect(payments).toEqual([
      { ay: "2026-27", type: "advance", payer_name: null, amount: 50000, source_path: "TIS-PDF", note: "Advance-tax challan from TIS PDF Part B3." },
    ]);

    const refunds = tisPdfToRefundRows(
      { rows: [], paymentRows: [], refundRows: [{ mode: null, nature: "", amount: 1000, date: null }], warnings: [] },
      "2026-27",
    );
    expect(refunds).toEqual([
      { ay: "2026-27", amount: 1000, mode: null, refund_date: null, source_path: "TIS-PDF", note: "From TIS PDF Part B4." },
    ]);
  });
});
