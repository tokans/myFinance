import { describe, expect, it } from "vitest";
import { INDIA_TAX_DEADLINES, nextAnnualOnOrAfter } from "./taxReminders";

describe("INDIA_TAX_DEADLINES", () => {
  it("covers the four advance-tax installments plus ITR filing", () => {
    expect(INDIA_TAX_DEADLINES.map((d) => d.key)).toEqual([
      "advance_q1", "advance_q2", "advance_q3", "advance_q4", "itr_filing",
    ]);
    expect(INDIA_TAX_DEADLINES.find((d) => d.key === "itr_filing")?.monthDay).toBe("07-31");
  });
});

describe("nextAnnualOnOrAfter", () => {
  it("returns this year's date when it is still ahead", () => {
    expect(nextAnnualOnOrAfter("2026-06-01", "07-31")).toBe("2026-07-31");
    expect(nextAnnualOnOrAfter("2026-07-31", "07-31")).toBe("2026-07-31"); // same day counts
  });
  it("rolls to next year once the date has passed", () => {
    expect(nextAnnualOnOrAfter("2026-08-01", "07-31")).toBe("2027-07-31");
    expect(nextAnnualOnOrAfter("2026-12-20", "03-15")).toBe("2027-03-15");
  });
});
