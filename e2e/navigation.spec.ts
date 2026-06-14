import { test, expect } from "@playwright/test";

test.describe("navigation and shell", () => {
  test("loads the dashboard at /", async ({ page }) => {
    await page.goto("/");
    // The shared SuiteShell renders the brand as sidebar text (not an <h1>),
    // so assert the Dashboard page's own heading.
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("HashRouter navigates between top-level pages", async ({ page }) => {
    await page.goto("/");

    // Use the sidebar nav links.
    await page.getByRole("link", { name: /^Accounts$/ }).click();
    await expect(page).toHaveURL(/#\/accounts$/);
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

    await page.getByRole("link", { name: /^Settings$/ }).click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Import is not a top-level sidebar item; reach it via its hash route to
    // confirm HashRouter resolves direct deep links too.
    await page.goto("/#/import");
    await expect(page).toHaveURL(/#\/import$/);
    await expect(page.getByRole("heading", { name: "Import Excel" })).toBeVisible();
  });

  test("shows the Tauri-only warning on DB-backed pages in browser mode", async ({ page }) => {
    await page.goto("/#/accounts");
    await expect(page.getByText(/Accounts are stored in SQLite/i)).toBeVisible();
    await expect(page.getByText(/npm run tauri:dev/i)).toBeVisible();
  });
});
