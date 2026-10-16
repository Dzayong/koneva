import { expect, test } from "@playwright/test";

test("signup can request WhatsApp verification without claiming that the email is verified", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/auth/signup", async (route) => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 202, json: { success: true, data: {
      verification_required: true, verification_method: "whatsapp", email: "owner@example.test", resend_after: 60,
    } } });
  });
  await page.goto("/signup");
  await page.getByLabel("Nama", { exact: true }).fill("Pemilik Uji");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Kata sandi", { exact: true }).fill("password-uji-aman-26");
  await page.getByRole("radio", { name: /WhatsApp/ }).check();
  await page.getByLabel("Nomor WhatsApp", { exact: true }).fill("081234567890");
  await page.locator("#terms").check();
  await page.getByRole("button", { name: "Buat akun" }).click();

  await expect(page.locator('[data-slot="card-title"]')).toHaveText("Verifikasi WhatsApp");
  await expect(page.getByText(/email tetap belum terverifikasi/i)).toBeVisible();
  expect(payload).toMatchObject({ verification_method: "whatsapp", phone_number: "081234567890", email: "owner@example.test" });
});
