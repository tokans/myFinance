import { describe, expect, it } from "vitest";
import {
  addDaysISO, addYearsISO, bucketFor, byDueDate, daysBetween, dueLabel,
  fyReviewDueDate, isSnoozed, nextAnnual, shouldNotify,
} from "./reminders";

const TODAY = "2026-05-31";

describe("date helpers", () => {
  it("daysBetween counts whole days, signed", () => {
    expect(daysBetween("2026-05-31", "2026-06-01")).toBe(1);
    expect(daysBetween("2026-05-31", "2026-05-30")).toBe(-1);
    expect(daysBetween("2026-05-31", "2026-05-31")).toBe(0);
  });
  it("addDaysISO crosses month boundaries", () => {
    expect(addDaysISO("2026-05-31", 1)).toBe("2026-06-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("addYearsISO clamps Feb 29 to Feb 28 in non-leap years", () => {
    expect(addYearsISO("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYearsISO("2026-04-10", 2)).toBe("2028-04-10");
  });
});

describe("bucketFor", () => {
  it("classifies overdue / due-soon / upcoming", () => {
    expect(bucketFor({ due_date: "2026-05-30" }, TODAY)).toBe("overdue");
    expect(bucketFor({ due_date: "2026-05-31" }, TODAY)).toBe("due_soon"); // today
    expect(bucketFor({ due_date: "2026-06-10" }, TODAY)).toBe("due_soon"); // within 14d
    expect(bucketFor({ due_date: "2026-07-01" }, TODAY)).toBe("upcoming");
  });
  it("a future snooze overrides the date bucket", () => {
    const r = { due_date: "2026-05-01", snoozed_until: "2026-06-15" };
    expect(isSnoozed(r, TODAY)).toBe(true);
    expect(bucketFor(r, TODAY)).toBe("snoozed");
  });
  it("a past snooze no longer hides the reminder", () => {
    const r = { due_date: "2026-05-30", snoozed_until: "2026-05-15" };
    expect(isSnoozed(r, TODAY)).toBe(false);
    expect(bucketFor(r, TODAY)).toBe("overdue");
  });
});

describe("shouldNotify", () => {
  it("fires for open overdue/due-soon, not for upcoming or non-open", () => {
    expect(shouldNotify({ due_date: "2026-05-30", status: "open" }, TODAY)).toBe(true);
    expect(shouldNotify({ due_date: "2026-06-10", status: "open" }, TODAY)).toBe(true);
    expect(shouldNotify({ due_date: "2026-07-10", status: "open" }, TODAY)).toBe(false);
    expect(shouldNotify({ due_date: "2026-05-30", status: "done" }, TODAY)).toBe(false);
    expect(shouldNotify({ due_date: "2026-05-30", snoozed_until: "2026-06-15" }, TODAY)).toBe(false);
  });
});

describe("nextAnnual", () => {
  it("advances a past annual date to the next future occurrence", () => {
    expect(nextAnnual("2025-03-15", TODAY)).toBe("2027-03-15"); // 2026-03-15 already passed
    expect(nextAnnual("2026-08-01", TODAY)).toBe("2026-08-01"); // still ahead → unchanged
  });
  it("pushes a date landing exactly on today one year out", () => {
    expect(nextAnnual("2024-05-31", TODAY)).toBe("2027-05-31");
  });
});

describe("fyReviewDueDate", () => {
  it("returns this year's FY start when still ahead, else next year", () => {
    expect(fyReviewDueDate(4, "2026-01-15")).toBe("2026-04-01");
    expect(fyReviewDueDate(4, "2026-05-31")).toBe("2027-04-01");
    expect(fyReviewDueDate(1, "2026-05-31")).toBe("2027-01-01");
  });
});

describe("misc", () => {
  it("byDueDate sorts ascending", () => {
    const arr = [{ due_date: "2026-07-01" }, { due_date: "2026-05-01" }].sort(byDueDate);
    expect(arr[0].due_date).toBe("2026-05-01");
  });
  it("dueLabel reads naturally", () => {
    expect(dueLabel("2026-05-31", TODAY)).toBe("today");
    expect(dueLabel("2026-06-01", TODAY)).toBe("tomorrow");
    expect(dueLabel("2026-05-30", TODAY)).toBe("1 day overdue");
    expect(dueLabel("2026-06-05", TODAY)).toBe("in 5 days");
  });
});
