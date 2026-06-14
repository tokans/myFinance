/**
 * 13 — FIRE calculator.
 * FIRE is gated behind having a Healthy Retirement goal. The locked screen lets
 * you create that goal in place (RetirementGoalDialog) — so the GIF captures the
 * unlock moment *and* the multi-step planner, ending on the computed FIRE number.
 *
 * The wizard prefills net worth from the seeded history; most steps have sane
 * defaults, so we only type the few fields each step gates on (age, income,
 * savings, monthly retirement spend).
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "13-fire-calculator",
  title: "FIRE calculator",
  shows:
    "Unlock FIRE by adding a retirement goal in place → walk the multi-step " +
    "planner → land on the computed FIRE number, progress, and savings gap.",

  // Seed accounts + history so net worth prefills and the projection is real.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("open FIRE — still locked");
    await h.goto("/fire");
    await h.waitFor("locked-cta");
    await h.pause(1500);

    h.log("unlock by adding a Healthy Retirement goal in place");
    await h.click("locked-cta");
    await h.waitFor("retirement-goal-submit");
    await h.pause(1400); // dialog is prefilled from the life-goal template
    await h.click("retirement-goal-submit");

    h.log("wizard unlocks");
    await h.waitFor("fire-ready");
    await h.pause(1200);
    await h.click("fire-ready");

    h.log("life stage");
    await h.waitFor("fire-age");
    await h.type("fire-age", "38");
    await h.pause(900);
    await h.click("fire-continue");

    h.log("financial snapshot");
    await h.waitFor("fire-money-income");
    await h.type("fire-money-income", "2400000");
    await h.pause(500);
    await h.type("fire-money-savings", "900000");
    await h.pause(900);
    await h.click("fire-continue");

    h.log("retirement vision (defaults)");
    await h.waitFor("fire-continue");
    await h.pause(900);
    await h.click("fire-continue");

    h.log("retirement spending");
    await h.waitFor("fire-money-spend");
    await h.type("fire-money-spend", "120000");
    await h.pause(900);
    await h.click("fire-continue");

    h.log("life goals (defaults)");
    await h.waitFor("fire-continue");
    await h.pause(800);
    await h.click("fire-continue");

    h.log("risk & assumptions → compute");
    await h.waitFor("fire-compute");
    await h.pause(900);
    await h.click("fire-compute");

    h.log("the FIRE number");
    await h.waitFor("fire-result");
    await h.pause(3000);
  },
};

export default scenario;
