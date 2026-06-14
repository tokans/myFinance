/**
 * 03 — Estate-readiness import.
 * A workbook with Contact / What-To-Do columns. The wizard detects the emergency
 * action + contact per account; the Emergencies page then lists them as
 * "emergency-ready" (which also unlocks Emergency planning).
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "03-estate-readiness-import",
  title: "Estate-readiness import",
  shows:
    "Import a workbook with Contact / What-To-Do columns → Emergencies page lists " +
    "the emergency-ready accounts with their action + contact.",

  async run(h) {
    h.log("open Accounts");
    await h.click("nav-accounts");
    await h.pause(800);

    h.log("import the estate-readiness workbook");
    await importSample(h, SAMPLE.estate, 1300);

    h.log("Emergencies page payoff");
    await h.goto("/emergencies");
    await h.waitFor("emergencies-prepared");
    await h.pause(2800);
  },
};

export default scenario;
