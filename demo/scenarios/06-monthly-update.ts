/**
 * 06 — Monthly update.
 * With accounts already in place (seeded off-camera), walk the one-at-a-time
 * monthly-update wizard for the current month, then show the dashboard picking
 * up the new values.
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "06-monthly-update",
  title: "Monthly update",
  shows:
    "Enter this month's value for each account, one at a time, then the " +
    "dashboard updates live.",

  // Seed accounts + history off-camera so the GIF is just the update flow.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("open Monthly update");
    await h.goto("/update");
    await h.waitFor("update-start");
    await h.pause(900);

    h.log("start the wizard");
    await h.click("update-start");
    await h.waitFor("update-value");
    await h.pause(800);

    // Enter a couple of accounts (then finish — no need to do all of them).
    for (const value of ["1925000", "655000"]) {
      await h.type("update-value", value);
      await h.pause(800);
      await h.click("update-save");
      await h.waitFor("update-value");
      await h.pause(600);
    }

    h.log("finish and see summary");
    await h.click("update-finish");
    await h.waitFor("update-done");
    await h.pause(1600);

    h.log("dashboard updates live");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-total-savings");
    await h.pause(2600);
  },
};

export default scenario;
