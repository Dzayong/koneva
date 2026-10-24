import { expect, test } from "@playwright/test";

test("retired Level & Misi page redirects to dashboard", async ({ page }) => {
  await page.goto("/readiness");
  await expect(page).toHaveURL(/\/dashboard$/);
});
