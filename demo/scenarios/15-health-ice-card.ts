/**
 * 15 — Health & ICE file.
 * Fill the health profile; the grab-and-go ICE (in-case-of-emergency) card
 * builds live beneath the form, pulling its emergency contacts from your Tier-0
 * people (one seeded off-camera). All deterministic (domain/ice.ts) — no LLM.
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "15-health-ice-card",
  title: "Health & ICE card",
  shows:
    "Fill the health profile → the ICE card builds live, with emergency contacts " +
    "drawn from your Tier-0 people.",

  // Seed accounts, then a Tier-0 person so the ICE card has an emergency contact.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
    await h.goto("/people");
    await h.waitFor("person-add-personal");
    await h.click("person-add-personal");
    await h.waitFor("person-form-name");
    await h.type("person-form-name", "Anita Sharma");
    await h.type("person-form-phone", "+91 99887 76655");
    await h.click("person-form-submit");
    await h.waitFor("person-row");
  },

  async run(h) {
    h.log("Health & ICE file");
    await h.goto("/estate/health");
    await h.waitFor("health-name");
    await h.pause(800);
    await h.type("health-name", "Anil Sharma");
    await h.pause(500);
    await h.type("health-blood", "B+");
    await h.pause(500);
    await h.type("health-allergies", "Penicillin, shellfish");
    await h.pause(800);

    h.log("save → ICE card builds");
    await h.click("health-save");
    await h.waitFor("health-saved");
    await h.waitFor("health-ice-card");
    // Bring the built card into frame (it renders just below the fold).
    await h.browser.execute(() => {
      document.querySelector('[data-testid="health-ice-card"]')
        ?.scrollIntoView({ block: "center" });
    });
    await h.pause(3000); // show the card + emergency contact
  },
};

export default scenario;
