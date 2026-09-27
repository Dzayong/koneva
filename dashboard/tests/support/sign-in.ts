import { expect, type Page } from "@playwright/test";

/** Password step, then the one-time code step. The fake API accepts the code in MockState.validCode. */
export async function signIn(page: Page, options: { email?: string; password?: string; code?: string } = {}): Promise<void> {
  await page.getByLabel("Email").fill(options.email ?? "ops@example.test");
  await page.getByLabel("Kata sandi").fill(options.password ?? "rahasia-uji");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByLabel("Kode verifikasi")).toBeVisible();
  await page.getByLabel("Kode verifikasi").fill(options.code ?? "123456");
  await page.getByRole("button", { name: "Verifikasi" }).click();
}
