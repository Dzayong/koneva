import { expect, test } from "@playwright/test";
import { PROXY, apiSignIn, call, createOperator, db, signInBrowser } from "./support/stack";

// OTP sender-budget alerts, real API + real PostgreSQL + real proxy (STACK-local). Events are inserted directly; how the limiter
// produces them is covered by the backend tests. No email is involved.
const seed = (kind: string, count: number, cap: number, ago: string) =>
  db.query("INSERT INTO otp_threshold_events(at, kind, window_count, cap) VALUES (now() - $1::interval, $2, $3, $4)", [ago, kind, count, cap]);

test.describe("OTP alerts (STACK-local)", () => {
  test.beforeEach(async () => { await db.query("DELETE FROM otp_threshold_events"); });

  test("empty, then an active alert appears on the summary and in the table with snapshot figures", async ({ page }) => {
    await signInBrowser(page, await createOperator());
    await page.goto("/operator/alerts");
    await expect(page.getByRole("status")).toContainText("Tidak ada peringatan aktif");
    await expect(page.getByText("Tidak ada ambang yang tercapai dalam 30 hari terakhir.")).toBeVisible();

    await seed("sender_70_percent", 140, 200, "5 minutes");
    await page.goto("/operator");
    const banner = page.getByRole("alert").filter({ hasText: "Peringatan kuota email OTP" });
    await expect(banner).toBeVisible();
    await banner.getByRole("link", { name: "Lihat detail" }).click();
    const row = page.getByRole("table").getByRole("row").nth(1);
    await expect(row).toContainText("Ambang 70% tercapai");
    await expect(row).toContainText("140 (70%)");
    await expect(row).toContainText("Aktif (dalam 24 jam)");
    await expect(page.getByRole("note")).toContainText("snapshot saat kejadian");
  });

  test("only operators with audit:read: others get no menu item, a refused page and a 403 from the API through the proxy", async ({ page }) => {
    await seed("sender_cap_reached", 200, 200, "1 hour");
    const limited = await createOperator(["payments:read"]);
    await signInBrowser(page, limited);
    await expect(page.getByRole("link", { name: "Peringatan" })).toHaveCount(0);
    await page.goto("/operator/alerts");
    await expect(page.getByText("Akses ditolak")).toBeVisible();
    const api = await apiSignIn(await createOperator(["payments:read", "workspaces:read"]));
    const denied = await call("/alerts/otp", { base: PROXY, session: api });
    expect(denied.status).toBe(403);
    expect(denied.text).not.toContain("sender_cap_reached");
    expect((await call("/alerts/otp", { base: PROXY })).status).toBe(401);
    const allowed = await call("/alerts/otp", { base: PROXY, session: await apiSignIn(await createOperator(["audit:read"])) });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.events).toHaveLength(1);
    expect(Object.keys(allowed.body.data.events[0]).sort()).toEqual(["active", "at", "cap_at_event", "id", "kind", "percent_at_event", "scope", "severity", "snapshot", "threshold_percent", "usage_at_event", "window_hours"]);
  });
});
