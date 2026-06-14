import { describe, expect, it } from "vitest";
import {
  emergencyFundMonths, emergencyFundTarget, isEmergencyFundLow,
  liquidAssetsTotal, spouseOperableTotal,
} from "./liquidity";

const accounts = [
  { type: "bank_savings", holding_mode: "either_or_survivor", value: 200000, kind: "asset" as const },
  { type: "checking", holding_mode: "single", value: 50000, kind: "asset" as const },
  { type: "fixed_deposit", holding_mode: "joint", value: 300000, kind: "asset" as const },
  { type: "loan", holding_mode: "joint", value: 100000, kind: "liability" as const },
];

describe("spouseOperableTotal", () => {
  it("sums survivor-mode asset accounts only", () => {
    // savings (either_or_survivor) 200000 + FD (joint) 300000 = 500000; checking single excluded; loan excluded
    expect(spouseOperableTotal(accounts)).toBe(500000);
  });
});

describe("liquidAssetsTotal", () => {
  it("sums only liquid asset types", () => {
    // savings 200000 + checking 50000 = 250000 (FD not liquid, loan not asset)
    expect(liquidAssetsTotal(accounts)).toBe(250000);
  });
});

describe("emergency fund", () => {
  it("computes target, months, and low flag", () => {
    expect(emergencyFundTarget(50000)).toBe(300000);
    expect(emergencyFundTarget(50000, 12)).toBe(600000);
    expect(emergencyFundMonths(250000, 50000)).toBe(5);
    expect(isEmergencyFundLow(250000, 50000)).toBe(true);   // 5 < 6
    expect(isEmergencyFundLow(400000, 50000)).toBe(false);  // 8 >= 6
  });
  it("is graceful when expenses are unknown", () => {
    expect(emergencyFundTarget(0)).toBe(0);
    expect(emergencyFundMonths(100, 0)).toBe(0);
    expect(isEmergencyFundLow(0, 0)).toBe(false);
  });
});
