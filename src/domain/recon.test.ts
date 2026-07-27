import { describe, expect, it } from "vitest";
import {
  suggestDuplicateIncomeLinks,
  suggestDuplicatePaymentLinks,
  suggestTransactionIncomeLinks,
  suggestTransactionPaymentLinks,
  reconNoteReasonLabel,
  documentLabelForSource,
} from "./recon";

describe("suggestTransactionPaymentLinks", () => {
  it("matches a bank debit to a tax payment of the same amount", () => {
    const links = suggestTransactionPaymentLinks(
      [{ id: 1, debit: 200000, credit: null }],
      [{ id: 10, amount: 200000, type: "advance" }],
    );
    expect(links).toEqual([{ a_kind: "transaction", a_id: 1, b_kind: "tax_payment", b_id: 10 }]);
  });

  it("tolerates a sub-rupee rounding difference", () => {
    const links = suggestTransactionPaymentLinks(
      [{ id: 1, debit: 200000.4, credit: null }],
      [{ id: 10, amount: 200000, type: "advance" }],
    );
    expect(links).toHaveLength(1);
  });

  it("ignores a credit-only transaction and a mismatched amount", () => {
    const links = suggestTransactionPaymentLinks(
      [{ id: 1, debit: null, credit: 200000 }, { id: 2, debit: 50000, credit: null }],
      [{ id: 10, amount: 200000, type: "advance" }],
    );
    expect(links).toEqual([]);
  });
});

describe("suggestTransactionIncomeLinks", () => {
  it("matches a bank credit to a reported income row of the same amount", () => {
    const links = suggestTransactionIncomeLinks(
      [{ id: 1, debit: null, credit: 15840 }],
      [{ id: 20, amount: 15840 }],
    );
    expect(links).toEqual([{ a_kind: "transaction", a_id: 1, b_kind: "tax_income", b_id: 20 }]);
  });

  it("ignores a debit-only transaction", () => {
    const links = suggestTransactionIncomeLinks([{ id: 1, debit: 15840, credit: null }], [{ id: 20, amount: 15840 }]);
    expect(links).toEqual([]);
  });
});

describe("suggestDuplicatePaymentLinks", () => {
  const base = { type: "tds_salary", note: null };

  it("flags the same TDS amount reported by two different known documents", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 500000, source_path: "Form16-PDF", ...base },
      { id: 2, amount: 500000, source_path: "26AS-PDF", ...base },
    ]);
    expect(links).toEqual([{ a_kind: "tax_payment", a_id: 1, b_kind: "tax_payment", b_id: 2, note: "exact" }]);
  });

  it("tags a close-but-not-identical amount as a discrepancy instead of an exact match", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 500000, source_path: "Form16-PDF", ...base },
      { id: 2, amount: 499500, source_path: "26AS-PDF", ...base },
    ]);
    expect(links).toEqual([{ a_kind: "tax_payment", a_id: 1, b_kind: "tax_payment", b_id: 2, note: "discrepancy" }]);
  });

  it("does not flag two rows from the SAME document as duplicates of each other", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 500000, source_path: "Form16-PDF", ...base },
      { id: 2, amount: 500000, source_path: "Form16-PDF", ...base },
    ]);
    expect(links).toEqual([]);
  });

  it("does not flag rows with an unrecognized source prefix (e.g. a manual edit)", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 500000, source_path: "MANUAL:edit", ...base },
      { id: 2, amount: 500000, source_path: "26AS-PDF", ...base },
    ]);
    expect(links).toEqual([]);
  });

  it("does not flag mismatched payment types even with the same amount", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 500000, type: "advance", note: null, source_path: "AIS-PDF" },
      { id: 2, amount: 500000, source_path: "26AS-PDF", ...base },
    ]);
    expect(links).toEqual([]);
  });

  it("flags a same-type same-amount pair across documents even when payer names would differ", () => {
    // payer_name is no longer part of the match at all — a deductor's registered name
    // (26AS) and an employer-header rendering (Form16) of the SAME withholding routinely
    // don't textually agree, so relying on it was silently missing real duplicates (same
    // trade-off as the other_sources income fix — see OTHER_SOURCES_HEAD).
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 500000, source_path: "26AS-PDF", ...base },
      { id: 2, amount: 500000, source_path: "Form16-PDF", ...base },
    ]);
    expect(links).toEqual([{ a_kind: "tax_payment", a_id: 1, b_kind: "tax_payment", b_id: 2, note: "exact" }]);
  });

  it("flags the same advance-tax challan across documents", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 200000, type: "advance", source_path: "AIS-PDF", note: "Advance-tax challan deposited 2026-03-11, from AIS PDF Part B3." },
      { id: 2, amount: 200000, type: "advance", source_path: "TIS-PDF", note: "Advance-tax challan deposited 2026-03-11, from TIS PDF Part B3." },
    ]);
    expect(links).toEqual([{ a_kind: "tax_payment", a_id: 1, b_kind: "tax_payment", b_id: 2, note: "exact" }]);
  });

  it("also flags a matching self-assessment-tax pair", () => {
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 15000, type: "self_assessment", note: null, source_path: "AIS-PDF" },
      { id: 2, amount: 15000, type: "self_assessment", note: null, source_path: "26AS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_payment", a_id: 1, b_kind: "tax_payment", b_id: 2, note: "exact" }]);
  });

  it("does not flag two same-amount advance challans deposited on different dates", () => {
    // Same amount, different quarterly installments — there's no structured date column
    // on tax_payments, but the deposit date embedded in each row's note (the one place a
    // payment's date lives today) is enough to tell them apart.
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 50000, type: "advance", source_path: "AIS-PDF", note: "Advance-tax challan deposited 2025-06-15, from AIS PDF Part B3." },
      { id: 2, amount: 50000, type: "advance", source_path: "TIS-PDF", note: "Advance-tax challan deposited 2025-09-15, from TIS PDF Part B3." },
    ]);
    expect(links).toEqual([]);
  });

  it("still flags a same-amount pair when only one side has a parseable deposit date", () => {
    // The note-date check is best-effort — most payment rows never have a date to check
    // at all (no structured column, and TDS/TCS notes only ever carry a TAN), so it only
    // gates a pair when BOTH sides happen to have one.
    const links = suggestDuplicatePaymentLinks([
      { id: 1, amount: 50000, type: "advance", source_path: "AIS-PDF", note: "Advance-tax challan deposited 2025-06-15, from AIS PDF Part B3." },
      { id: 2, amount: 50000, type: "advance", source_path: "TIS-PDF", note: "Advance-tax challan from TIS PDF Part B3." },
    ]);
    expect(links).toEqual([{ a_kind: "tax_payment", a_id: 1, b_kind: "tax_payment", b_id: 2, note: "exact" }]);
  });
});

describe("suggestDuplicateIncomeLinks", () => {
  it("flags the same dividend amount+label reported by AIS and TIS", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "AIS-PDF" },
      { id: 2, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "TIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "exact" }]);
  });

  it("tags a close-but-not-identical dividend amount as a discrepancy", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "AIS-PDF" },
      { id: 2, amount: 5080, head: "dividend", label: "Dividend from XYZ AMC", source_path: "TIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "discrepancy" }]);
  });

  it("does not flag different income heads even with the same amount", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "AIS-PDF" },
      { id: 2, amount: 5000, head: "other_sources", label: "Dividend from XYZ AMC", source_path: "TIS-PDF" },
    ]);
    expect(links).toEqual([]);
  });

  it("flags the same salary amount even though Form 16 and AIS phrase the label completely differently", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary income (Form 16 Part B item 6)", source_path: "Form16-PDF" },
      { id: 2, amount: 1600000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "exact" }]);
  });

  it("flags a same-amount other_sources pair across documents even with unrelated labels", () => {
    // other_sources is where TIS/26AS dump almost anything that isn't recognizably a
    // dividend, so the SAME real income can carry a category name on one side ("Salary")
    // and a deductor's company name on the other ("JM Financial Services Limited") that
    // will never fuzzy-match — company/category naming is too inconsistent across
    // documents for a label check to be reliable here, so amount+head alone is the signal
    // (same trade-off already made for SINGLE_SOURCE_HEADS).
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 16690804, head: "other_sources", label: "JM Financial Services Limited", source_path: "26AS-PDF" },
      { id: 2, amount: 16690804, head: "other_sources", label: "Salary", source_path: "TIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "exact" }]);
  });

  it("does not flag two other_sources rows from the SAME document even with the same amount", () => {
    // Unlike SINGLE_SOURCE_HEADS, other_sources still requires different documents — one
    // document can legitimately report several distinct same-amount payers in this bucket.
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 5000, head: "other_sources", label: "Interest from HDFC Bank FD", source_path: "AIS-PDF" },
      { id: 2, amount: 5000, head: "other_sources", label: "Interest from SBI Savings Account", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([]);
  });

  it("flags a ledger-derived dividend total against AIS's matching dividend row despite the generic label", () => {
    // "Refresh from transactions" (ledgerTaxSync.ts) writes ONE aggregate dividend row
    // summed from bank credits — its label never resembles AIS's payer-specific one, but
    // it's still a single-figure-per-head source, same treatment as a SINGLE_SOURCE_HEADS head.
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 5000, head: "dividend", label: "Dividend income (from bank transactions)", source_path: "LEDGER:dividend_income" },
      { id: 2, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "exact" }]);
  });

  it("flags a ledger-derived interest total against a TIS interest row the same way", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 12000, head: "other_sources", label: "Interest income (from bank transactions)", source_path: "LEDGER:interest_income" },
      { id: 2, amount: 12000, head: "other_sources", label: "Interest received (Section 194A)", source_path: "TIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "exact" }]);
  });

  it("flags a same-amount salary duplicate even within the SAME document (e.g. a table row parsed twice)", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" },
      { id: 2, amount: 1600000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "exact" }]);
  });

  it("does NOT flag a same-document duplicate for a multi-payer head like dividend (could be two real payouts)", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "AIS-PDF" },
      { id: 2, amount: 5000, head: "dividend", label: "Dividend from XYZ AMC", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([]);
  });

  it("groups a THREE-way same-amount salary duplicate across documents into pairwise candidates that all resolve to one survivor", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary income (Form 16 Part B item 6)", source_path: "Form16-PDF" },
      { id: 2, amount: 1600000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" },
      { id: 3, amount: 1600000, head: "salary", label: "Salary (TDS Annexure II)", source_path: "TIS-PDF" },
    ]);
    // every pair among the three matches — db/reconLinks.ts's runAutoRecon confirms all
    // three, which (since row 1 is on the 'a' side of every pair) leaves exactly one survivor.
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.note === "exact")).toBe(true);
  });

  it("maps a ₹75,000 salary gap to the standard deduction instead of a raw discrepancy", () => {
    // 1,600,000 (Form 16, net of Section 16) vs 1,675,000 (AIS, gross) — a 75,000 gap
    // that's well outside the normal 2%-of-max "close" band, so this only matches
    // because of the standard-deduction check.
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary income (Form 16 Part B item 6)", source_path: "Form16-PDF" },
      { id: 2, amount: 1675000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "standard_deduction" }]);
  });

  it("also maps a ₹50,000 salary gap (old-regime standard deduction)", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary income (Form 16 Part B item 6)", source_path: "Form16-PDF" },
      { id: 2, amount: 1650000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "standard_deduction" }]);
  });

  it("tolerates a small overshoot around the standard deduction (e.g. professional tax also netted out)", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary income (Form 16 Part B item 6)", source_path: "Form16-PDF" },
      { id: 2, amount: 1677400, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" }, // +77,400
    ]);
    expect(links).toEqual([{ a_kind: "tax_income", a_id: 1, b_kind: "tax_income", b_id: 2, note: "standard_deduction" }]);
  });

  it("does not map a salary gap that's nowhere near a known standard-deduction figure", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "salary", label: "Salary income (Form 16 Part B item 6)", source_path: "Form16-PDF" },
      { id: 2, amount: 1670000, head: "salary", label: "Salary received (Section 192)", source_path: "AIS-PDF" }, // +70,000 — outside tolerance of both 50k/75k
    ]);
    expect(links).toEqual([]);
  });

  it("does not apply the standard-deduction mapping to a non-salary head", () => {
    const links = suggestDuplicateIncomeLinks([
      { id: 1, amount: 1600000, head: "business", label: "Business income", source_path: "Form16-PDF" },
      { id: 2, amount: 1675000, head: "business", label: "Business income", source_path: "AIS-PDF" },
    ]);
    expect(links).toEqual([]); // same 75,000 gap, but standard deduction only ever applies to salary
  });
});

describe("reconNoteReasonLabel", () => {
  it("maps the machine tags to human labels", () => {
    expect(reconNoteReasonLabel("exact")).toBe("Exact match");
    expect(reconNoteReasonLabel("standard_deduction")).toBe("Standard deduction");
  });

  it("passes through a user-typed reason verbatim", () => {
    expect(reconNoteReasonLabel("26AS not yet updated for Q4")).toBe("26AS not yet updated for Q4");
  });

  it("falls back to a generic label for an empty/missing reason", () => {
    expect(reconNoteReasonLabel(null)).toBe("Confirmed manually");
    expect(reconNoteReasonLabel("  ")).toBe("Confirmed manually");
  });
});

describe("documentLabelForSource", () => {
  it("labels every recon-eligible document prefix", () => {
    expect(documentLabelForSource("Form16-PDF")).toBe("Form 16");
    expect(documentLabelForSource("26AS-PDF")).toBe("Form 26AS");
    expect(documentLabelForSource("AIS-PDF")).toBe("AIS (PDF)");
    expect(documentLabelForSource("TIS-PDF")).toBe("TIS (PDF)");
    expect(documentLabelForSource("AIS:some-id")).toBe("AIS Utility");
    expect(documentLabelForSource("CapitalGains-PDF")).toBe("Capital Gains Statement");
    expect(documentLabelForSource("ITR.ITR1.Salaries")).toBe("ITR import");
    expect(documentLabelForSource("LEDGER:dividend_income")).toBe("Bank ledger");
  });

  it("also labels display-only sources that aren't part of duplicate detection", () => {
    expect(documentLabelForSource("MANUAL:salary")).toBe("Manual entry");
    expect(documentLabelForSource("CLUB:42")).toBe("Clubbed income");
  });

  it("returns null for an unrecognized or missing source", () => {
    expect(documentLabelForSource("SOMETHING-ELSE")).toBeNull();
    expect(documentLabelForSource(null)).toBeNull();
  });
});
