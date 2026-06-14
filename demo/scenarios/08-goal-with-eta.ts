/**
 * 08 — Goal with ETA.
 * With balance history in place (seeded off-camera), create a savings goal; the
 * goal row projects an ETA from the trailing growth rate (domain/goals.ts).
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "08-goal-with-eta",
  title: "Goal with ETA",
  shows:
    "Create a savings goal → the goal row shows progress and a projected ETA " +
    "from the trailing growth rate.",

  // Seed accounts + a few months of growth so an ETA can be projected.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("open Goals");
    await h.click("nav-goals");
    await h.pause(900);

    h.log("add a goal");
    await h.click("goal-add-button");
    await h.waitFor("goal-form-name");
    await h.type("goal-form-name", "Financial Independence");
    await h.pause(700);
    await h.type("goal-form-amount", "20000000");
    await h.pause(800);
    await h.click("goal-form-submit");

    h.log("ETA renders");
    await h.waitFor("goal-row");
    await h.waitFor("goal-eta");
    await h.pause(2600);
  },
};

export default scenario;
