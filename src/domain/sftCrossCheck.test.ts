import { describe, expect, it } from "vitest";
import { crossCheckSft, type BankTransactionForCrossCheck, type SftRow } from "./sftCrossCheck";

function sft(overrides: Partial<SftRow> = {}): SftRow {
  return { sftCode: "SFT-005", description: "Cash deposit in savings account", reportingEntity: "HDFC Bank", amount: 100000, ...overrides };
}

function txn(overrides: Partial<BankTransactionForCrossCheck> = {}): BankTransactionForCrossCheck {
  return { id: 1, accountId: 1, institution: "HDFC Bank", debit: null, credit: null, ...overrides };
}

describe("crossCheckSft", () => {
  it("reconciles when a matching credit transaction sums within tolerance", () => {
    const [result] = crossCheckSft([sft()], [txn({ credit: 100000 })]);
    expect(result.status).toBe("reconciled");
    expect(result.matchedAccountIds).toEqual([1]);
    expect(result.bankTotal).toBe(100000);
  });

  it("reports no_data when no account's institution matches the reporting entity", () => {
    const [result] = crossCheckSft([sft()], [txn({ institution: "ICICI Bank", credit: 100000 })]);
    expect(result.status).toBe("no_data");
    expect(result.matchedAccountIds).toEqual([]);
  });

  it("matches institution names loosely (case, punctuation, corporate suffixes)", () => {
    // "TCS LTD" vs "Tcs Ltd." — same normalized entity after stripping case/punctuation/suffix noise.
    const [result] = crossCheckSft(
      [sft({ reportingEntity: "TCS LTD" })],
      [txn({ institution: "Tcs Ltd." })],
    );
    expect(result.matchedAccountIds).toEqual([1]);
  });

  it("infers a credit direction from deposit/dividend/interest wording and ignores debit-side amounts", () => {
    const [result] = crossCheckSft(
      [sft({ description: "Dividend received" })],
      [txn({ debit: 100000, credit: null })], // only a debit exists — shouldn't count toward a credit-expected SFT row
    );
    expect(result.bankTotal).toBe(0);
    expect(result.status).toBe("lower_in_bank"); // institution matched, but the credit side is empty → bank shows less than reported
  });

  it("infers a debit direction from purchase/investment wording", () => {
    const [result] = crossCheckSft(
      [sft({ sftCode: "SFT-018", description: "Purchase of mutual fund units", amount: 50000 })],
      [txn({ debit: 50000, credit: null })],
    );
    expect(result.status).toBe("reconciled");
  });

  it("sums both directions when the description gives no direction hint", () => {
    const [result] = crossCheckSft(
      [sft({ sftCode: "SFT-099", description: "Miscellaneous reported transaction", amount: 300 })],
      [txn({ debit: 100, credit: 200 })],
    );
    expect(result.bankTotal).toBe(300);
    expect(result.status).toBe("reconciled");
  });

  it("flags higher_in_bank / lower_in_bank outside tolerance", () => {
    const higher = crossCheckSft([sft({ amount: 100000 })], [txn({ credit: 200000 })])[0];
    expect(higher.status).toBe("higher_in_bank");
    const lower = crossCheckSft([sft({ amount: 100000 })], [txn({ credit: 10000 })])[0];
    expect(lower.status).toBe("lower_in_bank");
  });

  it("aggregates matched amounts across multiple accounts at the same institution", () => {
    const result = crossCheckSft(
      [sft({ amount: 15000 })],
      [txn({ accountId: 1, credit: 10000 }), txn({ id: 2, accountId: 2, credit: 5000 })],
    )[0];
    expect(result.matchedAccountIds.sort()).toEqual([1, 2]);
    expect(result.bankTotal).toBe(15000);
    expect(result.status).toBe("reconciled");
  });
});
