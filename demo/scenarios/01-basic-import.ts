/**
 * 01 — Basic net-worth import.
 * From the Accounts screen, open Import, pick the canonical default-schema
 * workbook (one sheet per month, Item | Value, SUM totals), auto-detect the
 * schema, commit, then land on the dashboard showing the month-over-month and
 * since-FY-start deltas.
 *
 * Note: Import is no longer a top-level nav item — it's reached from Accounts
 * (link) / by route. We navigate there explicitly.
 */
import { SAMPLE } from "../config.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "01-basic-import",
  title: "Basic net-worth import",
  shows:
    "Open Import from Accounts → auto-detect the default schema → preview → " +
    "commit → dashboard with month-over-month and since-FY-start deltas.",

  async run(h) {
    h.log("open Accounts");
    await h.click("nav-accounts");
    await h.pause(800);

    h.log("open Import");
    await h.goto("/import");
    await h.waitFor("import-dropzone");
    await h.pause(1000);

    h.log("choose the sample workbook");
    await h.uploadFile("import-file-input", SAMPLE.basic);

    // Default schema → review stage shows "Default schema detected" and a
    // ready "Preview rows" button.
    await h.waitFor("import-preview-button");
    await h.pause(1400);

    h.log("preview rows");
    await h.click("import-preview-button");
    await h.waitFor("import-commit-button");
    await h.pause(1400);

    h.log("commit import");
    await h.click("import-commit-button");
    await h.waitFor("import-done");
    await h.pause(1600);

    h.log("back to dashboard");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-total-savings");
    await h.waitFor("dashboard-mom-delta");
    await h.waitFor("dashboard-fy-delta");
    // Let the headline numbers and trend chart settle on screen.
    await h.pause(2600);
  },
};

export default scenario;
