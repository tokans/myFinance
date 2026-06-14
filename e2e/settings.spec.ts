import { test, expect } from "@playwright/test";

test.describe("Settings page", () => {
  test("renders defaults and lets the user switch theme to dark", async ({ page }) => {
    await page.goto("/#/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText(/won't persist/i)).toBeVisible();

    // Theme switch should toggle the html.dark class.
    const html = page.locator("html");
    await page.getByLabel("Theme").click();
    await page.getByRole("option", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);

    await page.getByLabel("Theme").click();
    await page.getByRole("option", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("currency, FY start, and date format selects are all functional", async ({ page }) => {
    await page.goto("/#/settings");

    // Currency has ≥10 options, so FiniteSetInput renders a type-ahead Combobox
    // (search input + buttons), not a Radix Select. Open, filter to a single
    // match, and let the component's Enter handler pick it.
    await page.getByLabel("Currency").click();
    await page.keyboard.type("USD");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Currency")).toContainText("USD");

    await page.getByLabel("Financial year starts").click();
    await page.getByRole("option", { name: /January/ }).click();
    await expect(page.getByLabel("Financial year starts")).toContainText("January");

    await page.getByLabel("Default date format").click();
    await page.getByRole("option", { name: /YYYY-MM-DD/ }).click();
    await expect(page.getByLabel("Default date format")).toContainText("YYYY-MM-DD");
  });
});
