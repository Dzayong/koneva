import { expect, test } from "@playwright/test";

/**
 * Runs against playwright.sandbox.config.ts's own dev server (KONEVA_SANDBOX=1 in that process's env only).
 * Companion "absent" case: tests/marketing/dev-banner.spec.ts, under the default (non-sandbox) config.
 */
test.describe("DEV sandbox banner (UI evidence, KONEVA_SANDBOX=1 instance)", () => {
  test("the banner is visible on the marketing page and on an app route", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByTestId("dev-sandbox-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("DEV");
    await expect(banner).toContainText("Sandbox");

    // A second, differently-shaped route confirms it is not tied to one page's markup.
    await page.goto("/syarat");
    await expect(page.getByTestId("dev-sandbox-banner")).toBeVisible();
  });
});
