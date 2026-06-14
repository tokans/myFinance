/**
 * 10 — Tax ITR import.
 * Tax tracking unlocks once there's an account (seeded off-camera). Import an
 * official-shaped ITR JSON: the parser extracts income / deductions / payments
 * and flags the sections it didn't map (the unmapped-sections panel).
 */
import { join } from "node:path";
import { DIRS, SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const ITR_FIXTURE = join(DIRS.fixtures, "itr-ay2026-27-sample.json");

const scenario: Scenario = {
  id: "10-tax-itr-import",
  title: "Tax ITR import",
  shows:
    "Import an ITR JSON → parsed income / deductions / tax payments, with an " +
    "unmapped-sections panel for anything the importer didn't recognize.",

  // Tax is gated on having an account — seed one off-camera so Tax is unlocked.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("open Tax");
    await h.click("nav-tax");
    await h.pause(900);

    h.log("open ITR import");
    await h.goto("/tax/import");
    await h.waitFor("tax-import-dropzone");
    await h.pause(800);

    h.log("choose the ITR JSON");
    await h.uploadFile("tax-import-input", ITR_FIXTURE);
    await h.waitFor("tax-unmapped");
    await h.pause(2800); // show parsed tables + the unmapped-sections badge

    h.log("save to database");
    await h.click("tax-commit");
    await h.waitFor("tax-done");
    await h.pause(2000);
  },
};

export default scenario;
