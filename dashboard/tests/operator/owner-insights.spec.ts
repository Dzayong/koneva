import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("owner insights (mock API; UI evidence only)", () => {
  test("owner sees read-only business metrics, service snapshot, alerts and activity", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights");
    await expect(page.getByRole("heading", { name: "Panel Pemilik" })).toBeVisible();
    await expect(page.getByText("Akun terdaftar")).toBeVisible();
    await expect(page.getByText("42", { exact: true })).toBeVisible();
    await expect(page.getByText("Pesan terkirim · 24 jam")).toBeVisible();
    await expect(page.getByText("Sisa batas internal: 188 dari 200; bukan kuota Gmail Google.")).toBeVisible();
    await expect(page.getByText("Status device WhatsApp")).toBeVisible();
    await expect(page.getByText("Akun baru terdaftar")).toBeVisible();
    await expect(page.getByText(/belum ada event persisten/i)).toHaveCount(1);
    expect(state.requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(state.requests.filter((r) => r.path === "/insights")).toHaveLength(1);
  });

  test("staff without owner:insights has no menu and cannot fetch owner metrics by opening the route", async ({ page }) => {
    const state = freshState({ permissions: ["payments:read"] });
    await installOperatorMock(page, state);
    await page.goto("/operator");
    await expect(page.getByRole("link", { name: "Panel Pemilik" })).toHaveCount(0);
    await page.goto("/operator/insights");
    await expect(page.getByText("Akses ditolak")).toBeVisible();
    expect(state.requests.some((r) => r.path === "/insights")).toBe(false);
  });
});
