/**
 * 05 — Manual review wizard.
 * A deliberately non-default workbook (sheet "Holdings", title/blank rows,
 * header on row 4, columns Instrument | Units | Market Value, no formulas, no
 * month in the sheet name). Auto-detect can't handle it, so we drive the review
 * wizard by hand: set the header row, assign column roles, pick a month, then
 * preview and commit.
 */
import { SAMPLE } from "../config.ts";
import type { Helpers, Scenario } from "./types.ts";

/** Pick a role for column `col` of sheet `idx` via its Radix select. */
async function selectRole(h: Helpers, idx: number, col: number, role: string): Promise<void> {
  await h.click(`col-role-trigger-${idx}-${col}`);
  await h.pause(450);
  await h.click(`col-role-item-${role}`);
  await h.pause(450);
}

const scenario: Scenario = {
  id: "05-wizard-fallback",
  title: "Manual review wizard",
  shows:
    "A non-default workbook → the review wizard: set the header row, assign " +
    "Account name + Balance columns, pick a month, preview, commit.",

  async run(h) {
    h.log("open Import");
    await h.goto("/import");
    await h.waitFor("import-dropzone");
    await h.pause(700);

    h.log("pick the non-default workbook");
    await h.uploadFile("import-file-input", SAMPLE.wizard);
    // "Needs review" — the per-sheet controls appear (Holdings = sheet 0).
    await h.waitFor("review-headerrow-0");
    await h.pause(1400);

    h.log("set header row to 4");
    await h.type("review-headerrow-0", "4");
    await h.pause(1000);

    h.log("Column A → Account name");
    await selectRole(h, 0, 0, "account");

    h.log("Column C → Balance");
    await selectRole(h, 0, 2, "balance");

    h.log("pick the month");
    await h.type("review-month-0", "2026-04");
    await h.pause(1000);

    h.log("preview rows");
    await h.click("import-preview-button");
    await h.waitFor("import-commit-button");
    await h.pause(1400);

    h.log("commit import");
    await h.click("import-commit-button");
    await h.waitFor("import-done");
    await h.pause(1800);
  },
};

export default scenario;
