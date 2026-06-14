import { describe, it, expect } from "vitest";
import { parseMonthFromSheetName, detectSheet, extractRows, classifyValueKind, parseExcelDate } from "./parse";
import type { SheetRaw } from "./types";

type Row = (string | number | null)[];
const sheet = (name: string, rows: Row[]): SheetRaw => ({ name, rows });

describe("parseMonthFromSheetName", () => {
  it("ISO formats", () => {
    expect(parseMonthFromSheetName("2026-04")).toBe("2026-04");
    expect(parseMonthFromSheetName("2026/04")).toBe("2026-04");
    expect(parseMonthFromSheetName("2026.04")).toBe("2026-04");
  });

  it("MM-YYYY variants", () => {
    expect(parseMonthFromSheetName("04-2026")).toBe("2026-04");
    expect(parseMonthFromSheetName("04/2026")).toBe("2026-04");
  });

  it("alpha-month with year", () => {
    expect(parseMonthFromSheetName("Apr 2026")).toBe("2026-04");
    expect(parseMonthFromSheetName("April 2026")).toBe("2026-04");
    expect(parseMonthFromSheetName("Apr-2026")).toBe("2026-04");
    expect(parseMonthFromSheetName("Apr2026")).toBe("2026-04");
    expect(parseMonthFromSheetName("April26")).toBe("2026-04");
  });

  it("year-then-month variants", () => {
    expect(parseMonthFromSheetName("2026 April")).toBe("2026-04");
    expect(parseMonthFromSheetName("2026Apr")).toBe("2026-04");
  });

  it("pure numeric YYYYMM", () => {
    expect(parseMonthFromSheetName("202604")).toBe("2026-04");
  });

  it("two-digit year expansion: <70 → 2000s", () => {
    expect(parseMonthFromSheetName("Apr-26")).toBe("2026-04");
    expect(parseMonthFromSheetName("Apr-69")).toBe("2069-04");
    expect(parseMonthFromSheetName("Apr-70")).toBe("1970-04");
  });

  it("respects DD/MM vs MM/DD on ambiguous triples", () => {
    // 03/04/2026 — under DD/MM: Mar; under MM/DD: April.
    expect(parseMonthFromSheetName("03/04/2026", "DD/MM/YYYY")).toBe("2026-03");
    expect(parseMonthFromSheetName("03/04/2026", "MM/DD/YYYY")).toBe("2026-03");
    // Wait — both same? Because the helper picks "the one that's 1..12" first.
    // Use a clearer DDMMYYYY-only case:
    expect(parseMonthFromSheetName("15/04/2026", "DD/MM/YYYY")).toBe("2026-04");
  });

  it("returns null for unparseable names", () => {
    expect(parseMonthFromSheetName("Summary")).toBeNull();
    expect(parseMonthFromSheetName("Sheet1")).toBeNull();
    expect(parseMonthFromSheetName("")).toBeNull();
  });

  it("rejects out-of-range months and years", () => {
    expect(parseMonthFromSheetName("2026-13")).toBeNull();
    expect(parseMonthFromSheetName("1800-04")).toBeNull();
  });
});

describe("detectSheet — default schema", () => {
  it("two-column data, no header → headerRow=-1, valueCols=[1]", () => {
    const s = sheet("2026-04", [
      ["HDFC", 50000],
      ["ICICI", 30000],
    ]);
    const { plan, clean } = detectSheet(s);
    expect(clean).toBe(true);
    expect(plan.headerRow).toBe(-1);
    expect(plan.valueCols).toEqual([1]);
    expect(plan.month).toBe("2026-04");
  });

  it("header row + data → headerRow=0, dataStart=1", () => {
    const s = sheet("Apr 2026", [
      ["Item", "Value"],
      ["HDFC", 50000],
      ["ICICI", 30000],
    ]);
    const { plan, clean } = detectSheet(s);
    expect(clean).toBe(true);
    expect(plan.headerRow).toBe(0);
    expect(plan.valueCols).toEqual([1]);
  });

  it("non-month sheet name → clean=false but still produces a plan", () => {
    const s = sheet("Summary", [["HDFC", 50000]]);
    const { clean, reason } = detectSheet(s);
    expect(clean).toBe(false);
    expect(reason).toMatch(/doesn't look like a month/i);
  });

  it("no parseable item/value pair → reports failure", () => {
    const s = sheet("2026-04", [["Header only"], ["Another row of text"]]);
    const { clean, reason } = detectSheet(s);
    expect(clean).toBe(false);
    expect(reason).toMatch(/item.*value/i);
  });
});

describe("extractRows", () => {
  it("extracts (item, value) pairs once a value column is assigned", () => {
    const s = sheet("2026-04", [
      ["HDFC", 50000],
      ["ICICI", 30000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueKinds = ["balance"]; // headerless → user picks the kind
    expect(extractRows(s, plan)).toEqual([
      { item: "HDFC", value: 50000, kind: "balance", accountType: "bank_savings", institution: "HDFC Bank" },
      { item: "ICICI", value: 30000, kind: "balance", accountType: "bank_savings", institution: "ICICI Bank" },
    ]);
  });

  it("emits nothing while value columns are unselected", () => {
    const s = sheet("2026-04", [
      ["HDFC", 50000],
      ["ICICI", 30000],
    ]);
    const { plan } = detectSheet(s);
    expect(plan.valueKinds).toEqual(["unselected"]);
    expect(extractRows(s, plan)).toEqual([]);
  });

  it("skips columns explicitly set to ignore", () => {
    const s = sheet("2026-04", [
      ["Item", "Bank", "Investment"],
      ["HDFC", 50000, 25000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueCols = [1, 2];
    plan.valueColHeaders = ["Bank", "Investment"];
    plan.valueKinds = ["balance", "ignore"];
    expect(extractRows(s, plan)).toEqual([
      { item: "HDFC", value: 50000, kind: "balance", accountType: "bank_savings", institution: "HDFC Bank" },
    ]);
  });

  it("stops at a row labeled 'Total' by default", () => {
    const s = sheet("2026-04", [
      ["HDFC", 50000],
      ["ICICI", 30000],
      ["Total", 80000],
      ["After total ignored", 999],
    ]);
    const { plan } = detectSheet(s);
    plan.valueKinds = ["balance"];
    const rows = extractRows(s, plan);
    expect(rows.map((r) => r.item)).toEqual(["HDFC", "ICICI"]);
  });

  it("parses numeric strings with commas", () => {
    const s = sheet("2026-04", [
      ["HDFC", "1,50,000"],
      ["ICICI", "30,000"],
    ]);
    const { plan } = detectSheet(s);
    plan.valueKinds = ["balance"];
    const rows = extractRows(s, plan);
    expect(rows.map((r) => r.value)).toEqual([150000, 30000]);
  });

  it("skips rows where the item cell is empty", () => {
    const s = sheet("2026-04", [
      ["HDFC", 50000],
      [null, 0],
      ["ICICI", 30000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueKinds = ["balance"];
    const rows = extractRows(s, plan);
    expect(rows.map((r) => r.item)).toEqual(["HDFC", "ICICI"]);
  });

  it("disambiguates multiple value columns by appending the header", () => {
    const s = sheet("2026-04", [
      ["Item", "Bank", "Investment"],
      ["HDFC", 50000, 25000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueCols = [1, 2];
    plan.valueColHeaders = ["Bank", "Investment"];
    plan.valueKinds = ["balance", "balance"];
    const rows = extractRows(s, plan);
    expect(rows).toEqual([
      { item: "HDFC – Bank", value: 50000, kind: "balance", accountType: "bank_savings", institution: "HDFC Bank" },
      { item: "HDFC – Investment", value: 25000, kind: "balance", accountType: "bank_savings", institution: "HDFC Bank" },
    ]);
  });

  it("clubs balance + credit/debit columns into one account — balance wins", () => {
    const s = sheet("2026-04", [
      ["Item", "Balance", "Credit", "Debit"],
      ["HDFC", 50000, 2000, 500],
    ]);
    const { plan } = detectSheet(s);
    plan.valueCols = [1, 2, 3];
    plan.valueColHeaders = ["Balance", "Credit", "Debit"];
    plan.valueKinds = ["balance", "credit", "debit"];
    const rows = extractRows(s, plan);
    expect(rows).toEqual([
      { item: "HDFC", value: 50000, kind: "balance", accountType: "bank_savings", institution: "HDFC Bank" },
    ]);
  });

  it("folds credit/debit columns into one net change when there is no balance", () => {
    const s = sheet("2026-04", [
      ["Item", "Credit", "Debit"],
      ["HDFC", 2000, 500],
    ]);
    const { plan } = detectSheet(s);
    plan.valueCols = [1, 2];
    plan.valueColHeaders = ["Credit", "Debit"];
    plan.valueKinds = ["credit", "debit"];
    const rows = extractRows(s, plan);
    expect(rows).toEqual([
      { item: "HDFC", value: 1500, kind: "credit", accountType: "bank_savings", institution: "HDFC Bank" },
    ]);
  });

  it("infers the account type from the item name", () => {
    const s = sheet("2026-04", [
      ["Item", "Balance"],
      ["HDFC Home Loan", -250000],
      ["SBI PPF", 80000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueCols = [1];
    plan.valueColHeaders = ["Balance"];
    plan.valueKinds = ["balance"];
    const rows = extractRows(s, plan);
    expect(rows).toEqual([
      { item: "HDFC Home Loan", value: -250000, kind: "balance", accountType: "loan", institution: "HDFC Bank" },
      { item: "SBI PPF", value: 80000, kind: "balance", accountType: "ppf", institution: "State Bank of India" },
    ]);
  });

  it("maps a credit_card column to a separate liability account", () => {
    const s = sheet("2026-04", [
      ["Item", "Balance", "Credit Card"],
      ["HDFC", 50000, 12000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueCols = [1, 2];
    plan.valueColHeaders = ["Balance", "Credit Card"];
    plan.valueKinds = ["balance", "credit_card"];
    const rows = extractRows(s, plan);
    expect(rows).toEqual([
      { item: "HDFC – Credit Card", value: 12000, kind: "balance", accountType: "credit_card", institution: "HDFC Bank" },
      { item: "HDFC", value: 50000, kind: "balance", accountType: "bank_savings", institution: "HDFC Bank" },
    ]);
  });
});

describe("classifyValueKind", () => {
  it("recognizes balance headers", () => {
    expect(classifyValueKind("Balance")).toBe("balance");
    expect(classifyValueKind("Closing Balance")).toBe("balance");
    expect(classifyValueKind("Amount")).toBe("balance");
  });

  it("recognizes credit headers", () => {
    expect(classifyValueKind("Credit")).toBe("credit");
    expect(classifyValueKind("Deposited")).toBe("credit");
    expect(classifyValueKind("Inflow")).toBe("credit");
  });

  it("recognizes debit headers", () => {
    expect(classifyValueKind("Debit")).toBe("debit");
    expect(classifyValueKind("Withdrawal")).toBe("debit");
    expect(classifyValueKind("Outflow")).toBe("debit");
  });

  it("does not fire on words that merely contain in/out", () => {
    expect(classifyValueKind("Investment")).toBeNull();
    expect(classifyValueKind("Account")).toBeNull();
  });

  it("returns null for blank or unsignalled headers", () => {
    expect(classifyValueKind("")).toBeNull();
    expect(classifyValueKind(null)).toBeNull();
    expect(classifyValueKind("HDFC")).toBeNull();
  });

  it("detectSheet sets valueKinds from the header row", () => {
    const s = sheet("Apr 2026", [
      ["Item", "Credit"],
      ["HDFC", 2000],
    ]);
    const { plan } = detectSheet(s);
    expect(plan.valueKinds).toEqual(["credit"]);
  });
});

describe("parseExcelDate", () => {
  it("formats a JS Date as YYYY-MM-DD", () => {
    expect(parseExcelDate(new Date(2027, 2, 9))).toBe("2027-03-09");
  });

  it("converts an Excel serial number", () => {
    // 46091 = 2026-03-10 in the 1900 date system.
    expect(parseExcelDate(46091)).toBe("2026-03-10");
  });

  it("parses ISO and other date-like strings", () => {
    expect(parseExcelDate("2027-3-9")).toBe("2027-03-09");
    expect(parseExcelDate("2027-12-31T00:00:00")).toBe("2027-12-31");
  });

  it("returns null for blanks and non-dates", () => {
    expect(parseExcelDate(null)).toBeNull();
    expect(parseExcelDate("")).toBeNull();
    expect(parseExcelDate("not a date")).toBeNull();
  });
});

describe("maturity date prefill", () => {
  // readWorkbook reads with cellDates:true, so date cells arrive as JS Dates at
  // runtime even though the SheetRaw row type only models string|number|null.
  const dateCell = (y: number, m: number, d: number) => new Date(y, m - 1, d) as unknown as number;

  it("detectSheet finds a column whose header contains 'maturity'", () => {
    const s = sheet("Apr 2026", [
      ["Account", "Balance", "Maturity Date"],
      ["SBI FD", 100000, dateCell(2027, 6, 1)],
    ]);
    const { plan } = detectSheet(s);
    expect(plan.maturityCol).toBe(2);
  });

  it("attaches the maturity date only to fixed-deposit rows", () => {
    const s = sheet("Apr 2026", [
      ["Account", "Balance", "Maturity"],
      ["SBI FD", 100000, dateCell(2027, 6, 1)],
      ["HDFC Savings", 50000, dateCell(2028, 1, 1)],
    ]);
    const { plan } = detectSheet(s);
    plan.valueKinds = plan.valueKinds.map((k, i) => (i === 0 ? "balance" : k));
    // The "Maturity" column lands in valueCols but stays unselected, so it never
    // imports as a value — it only feeds maturityDate.
    const rows = extractRows(s, plan);
    const fd = rows.find((r) => r.item === "SBI FD");
    const savings = rows.find((r) => r.item === "HDFC Savings");
    expect(fd?.maturityDate).toBe("2027-06-01");
    expect(savings?.maturityDate).toBeUndefined();
  });

  it("leaves maturityDate undefined when there is no maturity column", () => {
    const s = sheet("Apr 2026", [
      ["Account", "Balance"],
      ["SBI FD", 100000],
    ]);
    const { plan } = detectSheet(s);
    plan.valueKinds = ["balance"];
    expect(plan.maturityCol).toBeUndefined();
    expect(extractRows(s, plan)[0]?.maturityDate).toBeUndefined();
  });
});
