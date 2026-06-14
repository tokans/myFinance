/**
 * 11 — Financial-year start toggle.
 * With balance history in place (seeded off-camera), flip the FY start in
 * Settings from April (India FY, the default) to January; the dashboard's
 * "Change since FY start" delta recomputes against the new anchor month.
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "11-fy-start-toggle",
  title: "FY-start toggle",
  shows:
    "Flip FY start (April → January) in Settings → the dashboard's since-FY-start " +
    "delta recomputes against the new anchor.",

  // Seed a few months of growth so the FY-start delta visibly changes.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("dashboard — since-FY-start (April default)");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-fy-delta");
    await h.pause(2200);

    h.log("Settings → FY start");
    await h.click("nav-settings");
    await h.waitFor("settings-fy-trigger");
    await h.pause(900);

    h.log("switch April → January");
    await h.click("settings-fy-trigger");
    await h.pause(500);
    await h.click("settings-fy-jan");
    await h.pause(1200);

    h.log("dashboard delta flips");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-fy-delta");
    await h.pause(2600);
  },
};

export default scenario;
