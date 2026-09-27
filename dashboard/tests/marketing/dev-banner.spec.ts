import { expect, test } from "@playwright/test";

/**
 * Companion to tests-sandbox/dev-banner.spec.ts. This config's dev server (playwright.config.ts, port 13100)
 * never sets KONEVA_SANDBOX, standing in for a :13000-shaped fixture -- a differently-configured local
 * process, not the real :13000 stack, which this suite never starts or touches.
 */
test("the DEV sandbox banner is absent on a non-sandbox configuration (personal/:13000-shaped fixture)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dev-sandbox-banner")).toHaveCount(0);
});
