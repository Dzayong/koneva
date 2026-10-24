import { expect, test } from "@playwright/test";

test("password recovery requests an email code and confirms the new password", async ({ page }) => {
  const requests: unknown[] = [];
  const confirmations: unknown[] = [];
  await page.route("**/auth/password-reset/request", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true, data: { sent: true, expires_in: 1800, resend_after: 60 } } });
  });
  await page.route("**/auth/password-reset/confirm", async (route) => {
    confirmations.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true, data: { reset: true } } });
  });

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByRole("button", { name: "Kirim kode pemulihan" }).click();
  await expect(page.getByText(/Jika email owner@example.test terdaftar/)).toBeVisible();
  expect(requests).toEqual([{ email: "owner@example.test" }]);

  await page.getByLabel("Kode dari email").fill("123456");
  await page.getByLabel("Kata sandi baru", { exact: true }).fill("new-password-123");
  await page.getByLabel("Ulangi kata sandi baru").fill("new-password-123");
  await page.getByRole("button", { name: "Simpan kata sandi baru" }).click();
  await expect(page.getByText("Kata sandi diperbarui")).toBeVisible();
  expect(confirmations).toEqual([{ email: "owner@example.test", code: "123456", new_password: "new-password-123" }]);
});
