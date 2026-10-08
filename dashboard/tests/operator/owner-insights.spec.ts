import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("owner insights (mock API; UI evidence only)", () => {
  test("owner sees read-only business metrics, service snapshot, alerts and activity", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights");
    await expect(page.getByRole("heading", { name: "Ringkasan bisnis" })).toBeVisible();
    await expect(page.getByText("Konsol platform")).toBeVisible();
    await expect(page.getByText("Kinerja platform")).toBeVisible();
    await expect(page.getByText("Akun terdaftar")).toBeVisible();
    await expect(page.getByText("42", { exact: true })).toBeVisible();
    await expect(page.getByText("Pesan terkirim · 24 jam")).toBeVisible();
    await expect(page.getByText("Sisa batas internal: 188 dari 200; bukan kuota Gmail Google.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Device WhatsApp" })).toBeVisible();
    await expect(page.getByText("Akun baru terdaftar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Batas data yang tersedia" })).toBeVisible();
    expect(state.requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(state.requests.filter((r) => r.path === "/insights")).toHaveLength(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Buka navigasi operator" }).click();
    await expect(page.getByRole("navigation", { name: "Navigasi operator" }).getByRole("link", { name: "Ringkasan Pemilik" })).toBeVisible();
  });

  test("staff without owner:insights has no menu and cannot fetch owner metrics by opening the route", async ({ page }) => {
    const state = freshState({ permissions: ["payments:read"] });
    await installOperatorMock(page, state);
    await page.goto("/operator");
    await expect(page.getByRole("link", { name: "Ringkasan Pemilik" })).toHaveCount(0);
    await page.goto("/operator/insights");
    await expect(page.getByText("Akses ditolak")).toBeVisible();
    expect(state.requests.some((r) => r.path === "/insights")).toBe(false);
  });

  test("device counts are displayed and Butuh Perhatian is always visible as a link", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights");
    await expect(page.getByText("Device total")).toBeVisible();
    await expect(page.getByText("Device online")).toBeVisible();
    await expect(page.getByText("Device offline")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Butuh Perhatian" })).toBeVisible();
    const attentionLink = page.locator("a[href='/operator/insights/devices?attention=1']");
    await expect(attentionLink).toHaveAttribute("href", "/operator/insights/devices?attention=1");
  });

  test("Butuh Perhatian card shows when attention is zero", async ({ page }) => {
    const state = freshState();
    state.ownerInsights = { ...state.ownerInsights as Record<string, unknown>, device_counts: { total: 2, online: 2, offline: 0, attention: 0 } };
    await installOperatorMock(page, state);
    await page.goto("/operator/insights");
    await expect(page.getByRole("heading", { name: "Butuh Perhatian" })).toBeVisible();
    await expect(page.getByText("Tidak ada device yang butuh perhatian saat ini.")).toBeVisible();
  });

  test("device monitor page shows workspace filter and sortable columns", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights/devices");
    await expect(page.getByRole("heading", { name: "Device Monitor" })).toBeVisible();
    await expect(page.getByLabel("Filter workspace")).toBeVisible();
    await expect(page.getByText("Device Uji")).toBeVisible();
    await expect(page.getByText("Device Offline")).toBeVisible();
  });

  test("device detail page shows update timestamp", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights/devices/device-1");
    await expect(page.getByText("Device Uji")).toBeVisible();
    await expect(page.getByText("Diperbarui:")).toBeVisible();
    await expect(page.getByText("auto-refresh 60 detik")).toBeVisible();
  });

  test("workspace detail page shows update timestamp", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights/workspaces/w-1");
    await expect(page.getByText("Toko Uji")).toBeVisible();
    await expect(page.getByText("Diperbarui:")).toBeVisible();
    await expect(page.getByText("auto-refresh 60 detik")).toBeVisible();
  });

  test("system health page shows email transport and error rates", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/insights/health");
    await expect(page.getByText("Kondisi layanan")).toBeVisible();
    await expect(page.getByText("Transport email")).toBeVisible();
    await expect(page.getByText("dev-outbox")).toBeVisible();
    await expect(page.getByText("Error rate 1 jam")).toBeVisible();
  });
});
