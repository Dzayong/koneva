import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("MFA enrollment and recovery (UI evidence, API faked)", () => {
  test("first sign-in enrolls: code, QR + manual key, first code, recovery codes shown once and acknowledged", async ({ page }) => {
    const state = freshState({ authenticated: false, loginMode: "enroll" });
    await installOperatorMock(page, state);
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("ops@example.test");
    await page.getByLabel("Kata sandi").fill("rahasia-uji");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByText("belum memakai verifikasi dua langkah")).toBeVisible();

    await page.getByLabel("Kode pendaftaran").fill("SALAH-SALAH-SALAH");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Kode pendaftaran salah" })).toBeVisible();
    await page.getByLabel("Kode pendaftaran").fill("AAAAA-BBBBB-CCCCC");
    await page.getByRole("button", { name: "Lanjut" }).click();

    await expect(page.getByLabel("Kode QR autentikator")).toBeVisible();
    await expect(page.getByText("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBeVisible();
    await page.getByLabel("Kode verifikasi").fill("000000");
    await page.getByRole("button", { name: "Aktifkan dan masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Kode verifikasi salah" })).toBeVisible();
    expect(state.mfaVerified).toBe(0);
    await page.getByLabel("Kode verifikasi").fill("123456");
    await page.getByRole("button", { name: "Aktifkan dan masuk" }).click();

    // Recovery codes are on screen once; the panel is not entered until the operator confirms they were saved.
    await expect(page.getByRole("list", { name: "Kode pemulihan" })).toContainText("ABCDE-FGHJK");
    await expect(page).toHaveURL(/\/operator\/login/);
    const next = page.getByRole("button", { name: "Lanjut ke panel" });
    await expect(next).toBeDisabled();
    await page.getByLabel("Saya sudah menyimpan kode pemulihan ini.").check();
    await next.click();
    await expect(page).toHaveURL(/\/operator$/);
    // Nothing about the secret, the challenge or the codes was written to browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    for (const secret of ["JBSWY3DP", "ABCDE-FGHJK", "cccccccc"]) expect(stored).not.toContain(secret);
  });

  test("a recovery code can replace the authenticator code", async ({ page }) => {
    const state = freshState({ authenticated: false });
    await installOperatorMock(page, state);
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("ops@example.test");
    await page.getByLabel("Kata sandi").fill("rahasia-uji");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByRole("button", { name: "Pakai kode pemulihan" }).click();
    await page.getByLabel("Kode pemulihan").fill("AAAAA-BBBBB");
    await page.getByRole("button", { name: "Verifikasi" }).click();
    await expect(page).toHaveURL(/\/operator$/);
    expect(state.mfaVerified).toBe(1);
    const body = state.requests.find((r) => r.path === "/auth/mfa/verify")!.body as Record<string, unknown>;
    expect(body).toEqual({ challenge_id: "c".repeat(64), recovery_code: "AAAAA-BBBBB" });
  });

  test("starting again discards the challenge and returns to the password step", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false }));
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("ops@example.test");
    await page.getByLabel("Kata sandi").fill("rahasia-uji");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByRole("button", { name: "Mulai lagi" }).click();
    await expect(page.getByLabel("Kata sandi")).toBeVisible();
  });
});
