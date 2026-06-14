/**
 * 16 — Estate hub + family pack.
 * The estate-readiness import unlocks the Estate hub (it needs an emergency
 * action on an account). Tour the hub's breadth, then generate a plain-language
 * "what-if" family briefing — built from a snapshot of accounts/people/insurance
 * (domain/familyPack.ts), editable before export.
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "16-estate-family-pack",
  title: "Estate hub & family pack",
  shows:
    "The Estate readiness hub, then generate a plain-language family briefing " +
    "from a live snapshot of your finances.",

  // The estate-readiness workbook carries emergency actions, which unlocks the
  // Estate hub (feature='emergency') and gives the briefing accounts to describe.
  async setup(h) {
    await importSample(h, SAMPLE.estate);
  },

  async run(h) {
    h.log("Estate readiness hub");
    await h.goto("/estate");
    await h.waitFor("estate-hub");
    await h.pause(3000); // show the breadth of the module

    h.log("Family pack — generate a briefing");
    await h.goto("/estate/family-pack");
    await h.waitFor("familypack-person");
    await h.pause(700);
    await h.type("familypack-person", "Priya (spouse)");
    await h.pause(800);
    await h.click("familypack-generate");
    await h.waitFor("familypack-output");
    await h.pause(3200); // show the generated briefing text
  },
};

export default scenario;
