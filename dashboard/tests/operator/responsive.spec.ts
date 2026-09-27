import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("responsive, theme and motion (UI evidence)", () => {
  for (const path of ["/operator", "/operator/payments", "/operator/payments/inv-1", "/operator/students", "/operator/audit"]) {
    test(`no horizontal page scroll at phone width: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await installOperatorMock(page, freshState());
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }

  test("dark mode renders the confirmation dialog readable and reduced motion still works", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await installOperatorMock(page, freshState());
    await page.goto("/operator/payments/inv-1");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await context.close();
  });

  test("operator pages advertise no-index in metadata", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false }));
    await page.goto("/operator/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
