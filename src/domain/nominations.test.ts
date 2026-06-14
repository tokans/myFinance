import { describe, expect, it } from "vitest";
import {
  accountIdsWithoutNominee, exposureByPerson, isStaleNominee,
  nomineeShareSum, nomineeSharesValid,
} from "./nominations";

const holdings = [
  { account_id: 1, person_id: 10, role: "nominee", share_pct: 60 },
  { account_id: 1, person_id: 11, role: "nominee", share_pct: 40 },
  { account_id: 2, person_id: 10, role: "nominee", share_pct: 50 }, // sums to 50 → invalid
  { account_id: 3, person_id: 12, role: "co_holder", share_pct: null }, // not a nominee
];

describe("nomineeShareSum", () => {
  it("sums nominee shares for an account", () => {
    expect(nomineeShareSum(holdings, 1)).toBe(100);
    expect(nomineeShareSum(holdings, 2)).toBe(50);
    expect(nomineeShareSum(holdings, 3)).toBe(0);
  });
});

describe("nomineeSharesValid", () => {
  it("requires nominees to sum to 100, or none at all", () => {
    expect(nomineeSharesValid(holdings, 1)).toBe(true);
    expect(nomineeSharesValid(holdings, 2)).toBe(false);
    expect(nomineeSharesValid(holdings, 99)).toBe(true); // no nominees → valid
  });
});

describe("accountIdsWithoutNominee", () => {
  it("flags accounts with no nominee holding", () => {
    expect(accountIdsWithoutNominee([1, 2, 3, 4], holdings)).toEqual([3, 4]);
  });
});

describe("exposureByPerson", () => {
  it("credits each nominee their share of account value", () => {
    const accounts = [{ id: 1, value: 1000 }, { id: 2, value: 500 }];
    const exp = exposureByPerson(accounts, holdings);
    const p10 = exp.find((e) => e.person_id === 10)!;
    // 60% of 1000 + 50% of 500 = 600 + 250 = 850
    expect(p10.total).toBe(850);
    expect(p10.accountCount).toBe(2);
    const p11 = exp.find((e) => e.person_id === 11)!;
    expect(p11.total).toBe(400); // 40% of 1000
    // sorted descending
    expect(exp[0].person_id).toBe(10);
  });
});

describe("isStaleNominee", () => {
  it("is true past the 3-year threshold", () => {
    expect(isStaleNominee("2022-01-01", "2026-05-31")).toBe(true);
    expect(isStaleNominee("2024-06-01", "2026-05-31")).toBe(false);
    expect(isStaleNominee(undefined, "2026-05-31")).toBe(false);
  });
});
