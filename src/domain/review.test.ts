import { describe, expect, it } from "vitest";
import { annualReviewChecklist, lifeEventLabel, LIFE_EVENT_TYPES, reviewChecklistFor } from "./review";

describe("annualReviewChecklist", () => {
  it("covers the core surfaces", () => {
    const c = annualReviewChecklist();
    expect(c.length).toBeGreaterThanOrEqual(5);
    expect(c.join(" ").toLowerCase()).toContain("nominee");
    expect(c.join(" ").toLowerCase()).toContain("insurance");
  });
});

describe("reviewChecklistFor", () => {
  it("returns a non-empty tailored list for every event type", () => {
    for (const t of LIFE_EVENT_TYPES) {
      const c = reviewChecklistFor(t.value);
      expect(c.length).toBeGreaterThan(0);
    }
  });
  it("childbirth mentions guardian", () => {
    expect(reviewChecklistFor("childbirth").join(" ").toLowerCase()).toContain("guardian");
  });
  it("new_loan mentions liability", () => {
    expect(reviewChecklistFor("new_loan").join(" ").toLowerCase()).toContain("liability");
  });
});

describe("lifeEventLabel", () => {
  it("maps known types and passes through unknown", () => {
    expect(lifeEventLabel("marriage")).toBe("Marriage");
    expect(lifeEventLabel("zzz")).toBe("zzz");
  });
});
