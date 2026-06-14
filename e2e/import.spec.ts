import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";

/**
 * Build a minimal workbook in memory and return it as a Buffer.
 * The default schema: one sheet per month, col A = item, col B = value.
 */
function buildWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["HDFC Savings", 50000],
    ["ICICI Savings", 30000],
    ["Mutual Fund A", 120000],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "2026-04");
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["HDFC Savings", 55000],
    ["ICICI Savings", 31000],
    ["Mutual Fund A", 125000],
  ]);
  XLSX.utils.book_append_sheet(wb, ws2, "2026-05");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

test.describe("Import wizard (browser mode, parse only)", () => {
  test("parses a default-schema workbook and shows the review stage", async ({ page }) => {
    await page.goto("/#/import");

    // Banner warns that commit needs Tauri, but parsing should work.
    await expect(page.getByText(/Parsing works in the browser/i)).toBeVisible();

    const buffer = buildWorkbook();
    const input = page.locator("input#xlsx");
    await input.setInputFiles({
      name: "wallet.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    // We should land in the review stage with "Default schema detected".
    await expect(page.getByText(/Default schema detected/i)).toBeVisible();
    await expect(page.getByText(/wallet\.xlsx/)).toBeVisible();
    await expect(page.getByText(/2 sheets/i)).toBeVisible();

    // Both sheet names should be listed.
    await expect(page.getByLabel("2026-04")).toBeVisible();
    await expect(page.getByLabel("2026-05")).toBeVisible();
  });

  test("non-month sheet name shows a warning", async ({ page }) => {
    await page.goto("/#/import");

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["HDFC", 100]]);
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

    await page.locator("input#xlsx").setInputFiles({
      name: "ambiguous.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    await expect(page.getByText(/Needs review/i)).toBeVisible();
    await expect(page.getByText(/doesn't look like a month/i)).toBeVisible();
  });
});
