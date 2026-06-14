/**
 * 20 — Full tutorial (single take).
 *
 * The whole app tour in one continuous, real-time recording, powered by ONE
 * import file (06-tutorial-complete.xlsx). Unlike the marketing scenarios this
 * runs start-to-finish on camera and calls h.mark() at each beat — those marks
 * become the on-screen captions in the tutorial video (see demo/edit/tutorial.ts).
 *
 * Flow: import → dashboard → goals → FIRE → people → insurance → health/ICE →
 * estate hub → family pack → export. Every selector here is one the marketing
 * scenarios already established, so this is a curated single take over proven
 * paths. All names/numbers are fictional.
 *
 * Tax is intentionally omitted: it ingests an ITR JSON, not the Excel file, and
 * this tutorial is deliberately driven by a single import. (See scenario 10 for
 * the tax flow.)
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "20-full-tutorial",
  title: "Full tutorial (single take)",
  solo: true, // standalone artifact — excluded from demo:all (the montage set)
  shows:
    "The complete app tour in one take from a single import: dashboard, goals, " +
    "FIRE, people, insurance, health/ICE, estate hub, family pack, and export.",

  async run(h) {
    // 1 — Import ---------------------------------------------------------------
    h.mark("Start with one Excel file — myFinance reads it automatically");
    await h.pause(1200);
    await importSample(h, SAMPLE.tutorial, 700);
    await h.pause(800);

    // 2 — Dashboard ------------------------------------------------------------
    h.mark("Your net worth, month over month");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-total-savings");
    await h.pause(3200); // totals, MoM + since-FY-start deltas, trend chart

    // 3 — Goals ----------------------------------------------------------------
    h.mark("Set a goal — get a projected ETA from your real growth rate");
    await h.click("nav-goals");
    await h.pause(900);
    await h.click("goal-add-button");
    await h.waitFor("goal-form-name");
    await h.type("goal-form-name", "Financial Independence");
    await h.pause(600);
    await h.type("goal-form-amount", "25000000");
    await h.pause(700);
    await h.click("goal-form-submit");
    await h.waitFor("goal-eta");
    await h.pause(2600);

    // 4 — FIRE -----------------------------------------------------------------
    h.mark("Plan your FIRE number — unlock it by adding a retirement goal");
    await h.goto("/fire");
    await h.waitFor("locked-cta");
    await h.pause(1400);
    await h.click("locked-cta");
    await h.waitFor("retirement-goal-submit");
    await h.pause(1200);
    await h.click("retirement-goal-submit");
    await h.waitFor("fire-ready");
    await h.pause(1000);
    await h.click("fire-ready");

    h.mark("A guided planner — only a few fields, the rest is prefilled");
    await h.waitFor("fire-age");
    await h.type("fire-age", "37");
    await h.pause(800);
    await h.click("fire-continue");
    await h.waitFor("fire-money-income");
    await h.type("fire-money-income", "2200000");
    await h.pause(500);
    await h.type("fire-money-savings", "850000");
    await h.pause(800);
    await h.click("fire-continue");
    await h.waitFor("fire-continue"); // retirement vision (defaults)
    await h.pause(700);
    await h.click("fire-continue");
    await h.waitFor("fire-money-spend");
    await h.type("fire-money-spend", "110000");
    await h.pause(700);
    await h.click("fire-continue");
    await h.waitFor("fire-continue"); // life goals (defaults)
    await h.pause(700);
    await h.click("fire-continue");
    await h.waitFor("fire-compute");
    await h.pause(700);

    h.mark("Your FIRE number, progress, and the savings gap");
    await h.click("fire-compute");
    await h.waitFor("fire-result");
    await h.pause(3400);

    // 5 — People ---------------------------------------------------------------
    h.mark("People — the shared contact backbone for everything that follows");
    await h.goto("/people");
    await h.waitFor("person-add-personal");
    await h.pause(800);
    await h.click("person-add-personal");
    await h.waitFor("person-form-name");
    await h.type("person-form-name", "Meera Iyer");
    await h.pause(500);
    await h.type("person-form-phone", "+91 90000 12345");
    await h.pause(700);
    await h.click("person-form-submit");
    await h.waitFor("person-row");
    await h.pause(1800);

    // 6 — Insurance ------------------------------------------------------------
    h.mark("See your insurance coverage gap against a sensible target");
    await h.goto("/estate/insurance");
    await h.waitFor("insurance-income");
    await h.type("insurance-income", "2200000");
    await h.pause(500);
    await h.type("insurance-health-target", "1000000");
    await h.pause(700);
    await h.click("insurance-save-targets");
    await h.waitFor("insurance-coverage");
    await h.pause(2400);
    await h.click("insurance-add-policy");
    await h.waitFor("policy-form-insurer");
    await h.type("policy-form-insurer", "HDFC Life");
    await h.pause(500);
    await h.type("policy-form-sum", "5000000");
    await h.pause(700);
    await h.click("policy-form-submit");
    await h.waitFor("insurance-coverage");
    await h.pause(2800); // gap recomputes live against target

    // 7 — Health / ICE ---------------------------------------------------------
    h.mark("Build a grab-and-go ICE medical card");
    await h.goto("/estate/health");
    await h.waitFor("health-name");
    await h.pause(700);
    await h.type("health-name", "Arjun Verma");
    await h.pause(400);
    await h.type("health-blood", "O+");
    await h.pause(400);
    await h.type("health-allergies", "Penicillin, peanuts");
    await h.pause(700);
    await h.click("health-save");
    await h.waitFor("health-ice-card");
    await h.browser.execute(() => {
      document.querySelector('[data-testid="health-ice-card"]')
        ?.scrollIntoView({ block: "center" });
    });
    await h.pause(3000);

    // 8 — Estate hub -----------------------------------------------------------
    h.mark("Everything organized in one estate-readiness hub");
    await h.goto("/estate");
    await h.waitFor("estate-hub");
    await h.pause(3200);

    // 9 — Family pack ----------------------------------------------------------
    h.mark("Generate a plain-language briefing your family can actually use");
    await h.goto("/estate/family-pack");
    await h.waitFor("familypack-person");
    await h.pause(700);
    await h.type("familypack-person", "Meera (spouse)");
    await h.pause(800);
    await h.click("familypack-generate");
    await h.waitFor("familypack-output");
    await h.pause(3600);

    // 10 — Export --------------------------------------------------------------
    h.mark("And export everything back to Excel, anytime");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-export-button");
    await h.pause(1000);
    await h.click("dashboard-export-button");
    await h.waitForText("dashboard-export-button", "Exported");
    await h.pause(2600);

    h.mark("Private. Offline. Yours.");
    await h.pause(2600);
  },
};

export default scenario;
