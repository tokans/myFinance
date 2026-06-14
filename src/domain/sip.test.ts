import { describe, expect, it } from "vitest";
import {
  occurrenceForMonth,
  nextOccurrenceOnOrAfter,
  addMonthsYM,
  sipReminderPlan,
  sipIndicatorLabel,
  ordinal,
  SIP_LEAD_DAYS,
} from "./sip";

describe("occurrenceForMonth", () => {
  it("formats the occurrence, clamping the day to the month length", () => {
    expect(occurrenceForMonth("2026-06", 5)).toBe("2026-06-05");
    expect(occurrenceForMonth("2026-02", 31)).toBe("2026-02-28"); // non-leap
    expect(occurrenceForMonth("2024-02", 31)).toBe("2024-02-29"); // leap
    expect(occurrenceForMonth("2026-04", 31)).toBe("2026-04-30"); // 30-day month
  });
});

describe("addMonthsYM", () => {
  it("rolls across year boundaries", () => {
    expect(addMonthsYM("2026-12", 1)).toBe("2027-01");
    expect(addMonthsYM("2026-01", -1)).toBe("2025-12");
    expect(addMonthsYM("2026-06", 7)).toBe("2027-01");
  });
});

describe("nextOccurrenceOnOrAfter", () => {
  it("returns this month's occurrence when it's still ahead", () => {
    expect(nextOccurrenceOnOrAfter("2026-06-01", 5)).toBe("2026-06-05");
    expect(nextOccurrenceOnOrAfter("2026-06-05", 5)).toBe("2026-06-05"); // same day counts
  });
  it("rolls to next month once this month's date has passed", () => {
    expect(nextOccurrenceOnOrAfter("2026-06-06", 5)).toBe("2026-07-05");
    expect(nextOccurrenceOnOrAfter("2026-12-20", 5)).toBe("2027-01-05");
  });
});

describe("sipReminderPlan", () => {
  const sipDay = 5;

  it("does not create a reminder before the lead window", () => {
    // 4 days out, lead is 3 → still nothing.
    expect(
      sipReminderPlan({ today: "2026-06-01", sipDay, sipLastDone: null, existingDueDate: null }),
    ).toBeNull();
  });

  it("creates a reminder once within the lead window", () => {
    expect(
      sipReminderPlan({ today: "2026-06-02", sipDay, sipLastDone: null, existingDueDate: null }),
    ).toEqual({ dueDate: "2026-06-05" });
    expect(SIP_LEAD_DAYS).toBe(3);
  });

  it("keeps an existing reminder at its date so it can go overdue", () => {
    // Past the due date, reminder still present and unactioned → keep (overdue).
    expect(
      sipReminderPlan({
        today: "2026-06-09",
        sipDay,
        sipLastDone: null,
        existingDueDate: "2026-06-05",
      }),
    ).toEqual({ dueDate: "2026-06-05" });
  });

  it("drops the reminder once the occurrence has been actioned", () => {
    expect(
      sipReminderPlan({
        today: "2026-06-09",
        sipDay,
        sipLastDone: "2026-06-05",
        existingDueDate: "2026-06-05",
      }),
    ).toBeNull();
  });

  it("does not immediately recreate after Done, until next cycle's window", () => {
    // Done on the 3rd for the 5th; same day, no row → still null (handled).
    expect(
      sipReminderPlan({
        today: "2026-06-03",
        sipDay,
        sipLastDone: "2026-06-05",
        existingDueDate: null,
      }),
    ).toBeNull();
    // Next month, outside the window → null; inside the window → created.
    expect(
      sipReminderPlan({ today: "2026-07-01", sipDay, sipLastDone: "2026-06-05", existingDueDate: null }),
    ).toBeNull();
    expect(
      sipReminderPlan({ today: "2026-07-02", sipDay, sipLastDone: "2026-06-05", existingDueDate: null }),
    ).toEqual({ dueDate: "2026-07-05" });
  });
});

describe("sipIndicatorLabel", () => {
  it("shows 'due in N days' inside the lead window", () => {
    expect(sipIndicatorLabel("2026-06-03", 5, null)).toEqual({
      text: "SIP 5th · due in 2 days",
      tone: "due",
    });
    expect(sipIndicatorLabel("2026-06-05", 5, null).text).toBe("SIP 5th · due today");
  });
  it("flags a recently-passed unactioned occurrence as overdue", () => {
    expect(sipIndicatorLabel("2026-06-09", 5, null)).toEqual({
      text: "SIP 5th · overdue",
      tone: "due",
    });
  });
  it("is idle/monthly well before the date or once actioned", () => {
    expect(sipIndicatorLabel("2026-06-20", 5, "2026-06-05")).toEqual({
      text: "SIP 5th · monthly",
      tone: "idle",
    });
  });
});

describe("ordinal", () => {
  it("formats ordinals including the teens", () => {
    expect(["1st", "2nd", "3rd", "4th"].map((_, i) => ordinal(i + 1))).toEqual([
      "1st", "2nd", "3rd", "4th",
    ]);
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(31)).toBe("31st");
  });
});
