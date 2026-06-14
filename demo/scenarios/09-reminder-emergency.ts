/**
 * 09 — Reminder surfacing.
 * Create a custom reminder; it immediately surfaces in the Reminders list under
 * its due bucket (overdue / due soon / upcoming). FD maturities and document
 * expiries also surface here automatically.
 */
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "09-reminder-emergency",
  title: "Reminder surfacing",
  shows:
    "Add a custom reminder → it surfaces in the Reminders list under its due " +
    "bucket (alongside auto-tracked FD/document reminders).",

  async run(h) {
    h.log("open Reminders");
    await h.goto("/reminders");
    await h.pause(900);

    h.log("add a reminder");
    await h.click("reminder-add-button");
    await h.waitFor("reminder-form-title");
    await h.type("reminder-form-title", "Renew term life insurance");
    await h.pause(900);
    await h.click("reminder-form-submit");

    h.log("it surfaces in the list");
    await h.waitFor("reminder-row");
    await h.pause(2400);
  },
};

export default scenario;
