import { type Page } from "@playwright/test";

/** Password sign-in. The fake API creates the session directly from the login endpoint. */
export async function signIn(page: Page, options: { email?: string; password?: string } = {}): Promise<void> {
  await page.getByLabel("Email").fill(options.email ?? "ops@example.test");
  await page.getByLabel("Kata sandi").fill(options.password ?? "rahasia-uji");
  await page.getByRole("button", { name: "Masuk" }).click();
}
