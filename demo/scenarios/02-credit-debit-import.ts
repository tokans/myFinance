/**
 * 02 — Credit / debit cash-flow import.
 * A workbook with Credit/Debit columns and no balance column. The wizard
 * classifies the headers and carries a running balance forward (balance =
 * previous month ± net change); the dashboard then shows the trend.
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "02-credit-debit-import",
  title: "Credit / debit cash-flow import",
  shows:
    "Import a credit/debit workbook (no balance column) → header classification + " +
    "running-balance carry-forward → dashboard trend.",

  async run(h) {
    h.log("open Accounts");
    await h.click("nav-accounts");
    await h.pause(800);

    h.log("import the credit/debit workbook");
    await importSample(h, SAMPLE.creditDebit, 1300);

    h.log("dashboard");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-total-savings");
    await h.waitFor("dashboard-mom-delta");
    await h.pause(2600);
  },
};

export default scenario;
