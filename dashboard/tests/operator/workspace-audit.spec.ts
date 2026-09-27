import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

const SECRETS = ["sk_live_SECRET_KEY_123", "whsec_SECRET_WEBHOOK_456", "QR_STRING_789", "wgs_SESSION_TOKEN_000", "wa_session_blob_111"];

test.describe("workspace detail and audit (UI evidence, API faked)", () => {
  test("workspace detail is read-only and drops any secret an API might send", async ({ page }) => {
    const state = freshState();
    // A deliberately careless backend response: extra sensitive fields that must never reach the screen.
    Object.assign(state.workspace, { api_key: SECRETS[0], webhook_secret: SECRETS[1], qr_code: SECRETS[2], session_token: SECRETS[3], whatsapp_session: SECRETS[4] });
    (state.workspace["owner"] as Record<string, unknown>)["password_hash"] = "hash_SHOULD_NOT_SHOW";
    await installOperatorMock(page, state);
    await page.goto("/operator/workspaces/w-1");
    await expect(page.getByRole("heading", { name: "Toko Uji" })).toBeVisible();
    await expect(page.getByText("Pemilik Uji (owner@example.test)")).toBeVisible();
    await expect(page.getByText("12 / 10.000")).toBeVisible();
    const html = await page.content();
    for (const s of [...SECRETS, "hash_SHOULD_NOT_SHOW"]) expect(html).not.toContain(s);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    for (const s of SECRETS) expect(stored).not.toContain(s);
    // no controls that act on the workspace
    for (const name of [/hapus/i, /impersonasi|masuk sebagai/i, /grant|beri paket/i, /suspend/i]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    expect(state.requests.filter((r) => r.method !== "GET" && r.path !== "/auth/logout")).toEqual([]);
  });

  test("audit is read-only, shows what changed, and passes filters to the server", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/audit");
    await expect(page.getByText("invoice.confirm_payment")).toBeVisible();
    await expect(page.getByText("unpaid → paid")).toBeVisible();
    await expect(page.getByRole("link", { name: "INV-202609-0003" })).toHaveAttribute("href", "/operator/payments/inv-3");
    await page.getByLabel("Filter aksi").fill("invoice.confirm_payment");
    await expect.poll(() => state.requests.some((r) => r.path === "/audit" && r.query.includes("action=invoice.confirm_payment"))).toBe(true);
    for (const name of [/tambah/i, /hapus/i, /ubah/i, /buat/i]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    expect(state.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  test("audit without permission is refused on the page", async ({ page }) => {
    await installOperatorMock(page, freshState({ permissions: ["payments:read"] }));
    await page.goto("/operator/audit");
    await expect(page.getByText("Akses ditolak")).toBeVisible();
  });
});
