import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const event = (over: Record<string, unknown> = {}) => ({
  id: "e-1", at: at(1), kind: "sender_70_percent", scope: "sender_daily", window_hours: 24, threshold_percent: 70, severity: "warning",
  usage_at_event: 140, cap_at_event: 200, percent_at_event: 70, active: true, snapshot: true, ...over,
});
const alerts = (events: unknown[], over: Record<string, unknown> = {}) => ({
  events, has_active: (events as Array<{ active: boolean }>).some((e) => e.active), history_days: 30,
  current: { scope: "sender_daily", window_hours: 24, usage: 150, cap: 200, percent: 75, measured_at: new Date().toISOString() }, ...over,
});

test.describe("OTP alerts in the Operator Panel (UI evidence, API faked)", () => {
  test("empty state: says there is no alert, still shows current usage, and explains the limits of the alert", async ({ page }) => {
    await installOperatorMock(page, freshState());
    await page.goto("/operator/alerts");
    await expect(page.getByRole("heading", { name: "Peringatan OTP" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Tidak ada peringatan aktif");
    await expect(page.getByText("Tidak ada peringatan", { exact: true })).toBeVisible();
    await expect(page.getByText("Tidak ada ambang yang tercapai dalam 30 hari terakhir.")).toBeVisible();
    await expect(page.getByText(/12\s*dari 200 \(6%\)/)).toBeVisible();
    await expect(page.getByRole("note")).toContainText("hanya terlihat di halaman ini");
    await expect(page.getByRole("note")).toContainText("snapshot saat kejadian");
    await expect(page.getByRole("alert").filter({ hasText: "peringatan aktif" })).toHaveCount(0);
    // Home: no banner either.
    await page.goto("/operator");
    await expect(page.getByRole("heading", { name: "Ringkasan antrean" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Peringatan kuota email OTP" })).toHaveCount(0);
  });

  test("with an active alert: banner on the summary, and the table shows time, scope, snapshot usage, cap and status", async ({ page }) => {
    const state = freshState({ otpAlerts: alerts([event(), event({ id: "e-2", kind: "sender_cap_reached", severity: "critical", threshold_percent: 100, usage_at_event: 200, percent_at_event: 100, at: at(30), active: false })]) });
    await installOperatorMock(page, state);
    await page.goto("/operator");
    const banner = page.getByRole("alert").filter({ hasText: "Peringatan kuota email OTP" });
    await expect(banner).toBeVisible();
    await banner.getByRole("link", { name: "Lihat detail" }).click();
    await expect(page).toHaveURL(/\/operator\/alerts$/);
    await expect(page.getByRole("alert").filter({ hasText: "Ada peringatan aktif" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pemakaian terkini" })).toBeVisible();
    await expect(page.getByText(/150\s*dari 200 \(75%\)/)).toBeVisible();
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(3); // header + 2 events
    const first = rows.nth(1);
    await expect(first).toContainText("Ambang 70% tercapai");
    await expect(first).toContainText("Pengirim email OTP, seluruh sistem, 24 jam bergulir");
    await expect(first).toContainText("140 (70%)");
    await expect(first).toContainText("200");
    await expect(first).toContainText("Aktif (dalam 24 jam)");
    const second = rows.nth(2);
    await expect(second).toContainText("Batas maksimum tercapai");
    await expect(second).toContainText("200 (100%)");
    await expect(second).toContainText("Riwayat");
    await expect(page.getByRole("columnheader", { name: "Pemakaian saat kejadian (snapshot)" })).toBeVisible();
    expect(state.requests.filter((r) => r.method !== "GET")).toEqual([]); // read only
  });

  test("an old event is history only: no banner and 'no active alert', but it stays listed", async ({ page }) => {
    await installOperatorMock(page, freshState({ otpAlerts: alerts([event({ at: at(50), active: false })]) }));
    await page.goto("/operator");
    await expect(page.getByRole("alert").filter({ hasText: "Peringatan kuota email OTP" })).toHaveCount(0);
    await page.goto("/operator/alerts");
    await expect(page.getByRole("status")).toContainText("Tidak ada peringatan aktif");
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
    await expect(page.getByText("Riwayat", { exact: true })).toBeVisible();
  });

  test("the page never renders fields it does not know: an email, IP, code or key sent by a faulty API stays out of the DOM", async ({ page }) => {
    const leaky = { ...event(), email: "orang@gmail.com", ip: "203.0.113.9", code: "654321", recipient_key: "f".repeat(64) };
    await installOperatorMock(page, freshState({ otpAlerts: alerts([leaky], { emails: ["orang@gmail.com"] }) }));
    await page.goto("/operator/alerts");
    await expect(page.getByRole("table")).toBeVisible();
    const html = await page.content();
    for (const raw of ["orang@gmail.com", "203.0.113.9", "654321", "f".repeat(64)]) expect(html).not.toContain(raw);
  });

  test("without audit:read there is no menu item, no banner, and the page is refused", async ({ page }) => {
    const state = freshState({ permissions: ["payments:read"], otpAlerts: alerts([event()]) });
    await installOperatorMock(page, state);
    await page.goto("/operator");
    await expect(page.getByRole("link", { name: "Peringatan" })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "Peringatan kuota email OTP" })).toHaveCount(0);
    await page.goto("/operator/alerts");
    await expect(page.getByText("Akses ditolak")).toBeVisible();
    expect(state.requests.some((r) => r.path === "/alerts/otp")).toBe(false); // not even requested
  });

  test("a failing API shows an error with retry instead of pretending there is no alert", async ({ page }) => {
    const state = freshState({ otpAlerts: alerts([]), listMode: "hang" });
    await installOperatorMock(page, state);
    await page.route("**/api/operator/alerts/otp", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "x" } }) }));
    await page.goto("/operator/alerts");
    await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Tidak ada peringatan aktif" })).toHaveCount(0);
  });
});
