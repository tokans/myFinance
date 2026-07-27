import { describe, expect, it } from "vitest";
import { buildItrJson, type ItrBuilderInput } from "./itrBuilder";
import { parseItrJson } from "./itrParser";
import { EMPTY_TAX_PROFILE } from "./taxProfile";
import type { TaxDeductionRow, TaxIncomeRow, TaxPaymentRow } from "@/db/tax";

function inc(head: TaxIncomeRow["head"], amount: number): TaxIncomeRow {
  return { id: 0, ay: "2026-27", head, label: head, amount, source_path: null, note: null, excluded: false };
}
function ded(section: string, amount: number): TaxDeductionRow {
  return { id: 0, ay: "2026-27", section, label: section, amount, source_path: null, note: null };
}
function pay(type: TaxPaymentRow["type"], amount: number, payer: string | null = null): TaxPaymentRow {
  return { id: 0, ay: "2026-27", type, payer_name: payer, amount, source_path: null, note: null };
}

const base: Omit<ItrBuilderInput, "form"> = {
  ay: "2026-27",
  profile: { ...EMPTY_TAX_PROFILE, pan: "ABCDE1234F", name: "Test" },
  regime: "old",
  income: [inc("salary", 800_000), inc("other_sources", 20_000)],
  deductions: [ded("80C", 150_000)],
  payments: [pay("tds_salary", 30_000, "ACME LTD")],
};

describe("buildItrJson round-trips through parseItrJson", () => {
  it("ITR-1: income, deduction and TDS survive a build → parse", () => {
    const { json, summary } = buildItrJson({ ...base, form: "1" });
    const parsed = parseItrJson(json, "test.json");

    expect(parsed.itrForm).toBe("1");
    expect(parsed.pan).toBe("ABCDE1234F");
    expect(parsed.income.find((r) => r.head === "salary")?.amount).toBe(800_000);
    expect(parsed.income.find((r) => r.head === "other_sources")?.amount).toBe(20_000);
    expect(parsed.deductions.find((r) => r.section === "80C")?.amount).toBe(150_000);
    expect(parsed.payments.find((r) => r.type === "tds_salary")?.amount).toBe(30_000);
    expect(parsed.assessment.gross_total_income).toBe(820_000);
    expect(parsed.assessment.total_income).toBe(670_000);
    // Summary matches the built totals.
    expect(summary.grossTotalIncome).toBe(820_000);
    expect(summary.totalIncome).toBe(670_000);
  });

  it("ITR-1: dividend income folds into the same Other Sources total as other_sources (no separate JSON field)", () => {
    const { json, summary } = buildItrJson({
      ...base, form: "1",
      income: [inc("salary", 800_000), inc("other_sources", 20_000), inc("dividend", 5_000)],
    });
    const parsed = parseItrJson(json, "test.json");
    expect(parsed.income.find((r) => r.head === "other_sources")?.amount).toBe(25_000);
    expect(summary.grossTotalIncome).toBe(825_000);
  });

  it("ITR-2: capital gains survive via PartB-TI", () => {
    const { json } = buildItrJson({
      ...base, form: "2",
      income: [inc("salary", 500_000), inc("cg_long", 200_000)],
      deductions: [],
    });
    const parsed = parseItrJson(json, "test.json");
    expect(parsed.itrForm).toBe("2");
    expect(parsed.income.find((r) => r.head === "cg_long")?.amount).toBe(200_000);
  });

  it("ITR-4: presumptive business income survives via ScheduleBP", () => {
    const { json } = buildItrJson({
      ...base, form: "4",
      income: [inc("business", 900_000)],
      deductions: [],
    });
    const parsed = parseItrJson(json, "test.json");
    expect(parsed.itrForm).toBe("4");
    expect(parsed.income.find((r) => r.head === "business")?.amount).toBe(900_000);
  });
});
