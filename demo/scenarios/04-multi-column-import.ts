/**
 * 04 — Multi-column import.
 * A workbook where one row carries several value columns (Savings, Fixed
 * Deposit, Credit Card). Each becomes its own account — the header is appended
 * to the name, and the Credit Card column becomes a separate liability — so the
 * Accounts list ends up with several accounts from a single row.
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "04-multi-column-import",
  title: "Multi-column import",
  shows:
    "One row with multiple value columns → several accounts (header appended; " +
    "Credit Card as a liability) on the Accounts list.",

  async run(h) {
    h.log("open Accounts");
    await h.click("nav-accounts");
    await h.pause(800);

    h.log("import the multi-column workbook");
    await importSample(h, SAMPLE.multiColumn, 1300);

    h.log("Accounts list payoff");
    await h.click("nav-accounts");
    await h.waitFor("accounts-list");
    await h.pause(2800);
  },
};

export default scenario;
