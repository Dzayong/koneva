import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("MFA endpoints are disabled (UI evidence, API faked)", () => {
  test("sign-in completes with just email and password — no MFA step", async ({ page }) => {
    const state = freshState({ authenticated: false });
    await installOperatorMock(page, state);
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("ops@example.test");
    await page.getByLabel("Kata sandi").fill("rahasia-uji");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page).toHaveURL(/\/operator$/);
    expect(state.authenticated).toBe(true);
  });
});
