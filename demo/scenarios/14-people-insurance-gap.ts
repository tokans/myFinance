/**
 * 14 — People backbone + insurance coverage gap.
 * Add a person (the contact every estate record links to), then set coverage
 * targets and a term policy on the Insurance page. The coverage assessment
 * recomputes live, showing the term/health/loan-protection gaps against target
 * (deterministic math in domain/insurance.ts).
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "14-people-insurance-gap",
  title: "People & insurance gap",
  shows:
    "Add a person, then set income + a term policy on Insurance → the coverage " +
    "assessment shows the gap to target, live.",

  // Seed accounts (incl. a liability) so the loan-protection target is real.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("People — the shared contact backbone");
    await h.goto("/people");
    await h.waitFor("person-add-personal");
    await h.pause(800);
    await h.click("person-add-personal");
    await h.waitFor("person-form-name");
    await h.type("person-form-name", "Priya Sharma");
    await h.pause(500);
    await h.type("person-form-phone", "+91 98765 43210");
    await h.pause(700);
    await h.click("person-form-submit");
    await h.waitFor("person-row");
    await h.pause(1500);

    h.log("Insurance — set coverage targets");
    await h.goto("/estate/insurance");
    await h.waitFor("insurance-income");
    await h.type("insurance-income", "2400000");
    await h.pause(500);
    await h.type("insurance-health-target", "1000000");
    await h.pause(700);
    await h.click("insurance-save-targets");
    await h.waitFor("insurance-coverage");
    await h.pause(2200); // gaps surface against the targets

    h.log("add a term policy → coverage recomputes against target");
    await h.click("insurance-add-policy");
    await h.waitFor("policy-form-insurer");
    await h.type("policy-form-insurer", "HDFC Life");
    await h.pause(500);
    await h.type("policy-form-sum", "5000000");
    await h.pause(700);
    await h.click("policy-form-submit");
    await h.waitFor("insurance-coverage");
    await h.pause(2600);
  },
};

export default scenario;
