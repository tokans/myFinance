/**
 * 12 — Excel export.
 * With balance history in place (seeded off-camera), one click on the Dashboard
 * writes the whole portfolio back out as an .xlsx in the default schema. Under
 * VITE_DEMO_MODE the native save dialog is skipped and the file lands in
 * demo/output/, so the run completes unattended (see ExportButton.tsx).
 */
import { SAMPLE } from "../config.ts";
import { importSample } from "./_shared.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "12-excel-export",
  title: "Excel export",
  shows:
    "One-click export from the Dashboard → the whole portfolio is written back " +
    "out as an .xlsx workbook in the default schema.",

  // Seed accounts + history so there's something to export.
  async setup(h) {
    await importSample(h, SAMPLE.basic);
  },

  async run(h) {
    h.log("dashboard");
    await h.click("nav-dashboard");
    await h.waitFor("dashboard-export-button");
    await h.pause(1400);

    h.log("export to Excel");
    await h.click("dashboard-export-button");
    // The button cycles "Export" → "Exporting…" → "Exported".
    await h.waitForText("dashboard-export-button", "Exported");
    await h.pause(2400);
  },
};

export default scenario;
