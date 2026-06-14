import { describe, it, expect } from "vitest";
import { partnerWindowOpen, PARTNER_WINDOW_MONTHS } from "./patron";

describe("partnerWindowOpen", () => {
  it("uses a 3-month window", () => {
    expect(PARTNER_WINDOW_MONTHS).toBe(3);
  });

  it("is open the day after donating", () => {
    expect(partnerWindowOpen("2026-06-01", "2026-06-02")).toBe(true);
  });

  it("is open on the donation day itself", () => {
    expect(partnerWindowOpen("2026-06-01", "2026-06-01")).toBe(true);
  });

  it("is open just before the 3-month boundary", () => {
    expect(partnerWindowOpen("2026-06-01", "2026-08-31")).toBe(true);
  });

  it("is closed on the 3-month boundary (exclusive)", () => {
    expect(partnerWindowOpen("2026-06-01", "2026-09-01")).toBe(false);
  });

  it("is closed well past the window", () => {
    expect(partnerWindowOpen("2026-06-01", "2026-12-01")).toBe(false);
  });

  it("returns false for an unparseable donation date", () => {
    expect(partnerWindowOpen("not-a-date", "2026-06-02")).toBe(false);
  });
});
