import { describe, expect, it } from "vitest";
import { daysSinceCheckin, isCheckinStale } from "./access";

describe("daysSinceCheckin", () => {
  it("counts days, null when unset", () => {
    expect(daysSinceCheckin("2026-05-01", "2026-05-31")).toBe(30);
    expect(daysSinceCheckin("2026-05-31", "2026-05-31")).toBe(0);
    expect(daysSinceCheckin(null, "2026-05-31")).toBeNull();
  });
});

describe("isCheckinStale", () => {
  it("flags stale past the threshold; unset is not stale", () => {
    expect(isCheckinStale("2026-01-01", "2026-05-31", 90)).toBe(true);  // ~150 days
    expect(isCheckinStale("2026-05-01", "2026-05-31", 90)).toBe(false); // 30 days
    expect(isCheckinStale(null, "2026-05-31")).toBe(false);
  });
});
