import { expect, test } from "@playwright/test";

const ME = {
  success: true,
  data: {
    user: { id: "u1", email: "owner@test.example", name: "Owner Uji", email_verified: true },
    workspace: { id: "w1", name: "WS Uji", role: "owner" },
    workspaces: [{ id: "w1", name: "WS Uji", role: "owner" }],
    permissions: ["billing:manage", "devices:read"],
    subscription: { plan_id: "starter", plan_name: "Starter", status: "active", can_send: true, days_left: 25, period_end: "2026-11-08T00:00:00Z" },
    support_contact: null,
  },
};

const UNPAID_INVOICE = {
  id: "inv-1", number: "INV-202610-0001", plan_id: "starter", cycle: "monthly",
  amount_idr: 99000, status: "unpaid" as const, due_at: "2026-10-15T00:00:00Z",
  paid_at: null, method: null, reference: null, created_at: "2026-10-08T00:00:00Z",
};

const PAID_INVOICE = {
  ...UNPAID_INVOICE, id: "inv-old", number: "INV-202609-0001", status: "paid" as const,
  paid_at: "2026-09-20T10:00:00Z", method: "transfer", reference: "TRF-123",
};

const VOID_INVOICE = {
  ...UNPAID_INVOICE, id: "inv-void", number: "INV-202610-0002", status: "void" as const,
};

const BASE_BILLING = {
  subscription: {
    plan_id: "starter", plan_name: "Starter", status: "active" as const, cycle: "monthly" as const,
    period_start: "2026-10-08T00:00:00Z", period_end: "2026-11-08T00:00:00Z", days_left: 25, grace_days: 7,
  },
  usage: {
    messages_used: 50, messages_limit: 1000, resets_at: "2026-11-08T00:00:00Z",
    messages_held: 0, exempt_used: 0, quota_headline: null, quota_note: null,
    devices_used: 1, devices_limit: 3, members_used: 1, members_limit: 5,
  },
  student: { verified: false, requested: false },
  plans: [] as unknown[],
  payment: { instructions: "Transfer ke BCA 1234567890 a.n. Koneva", contact: "koneva@example.test" },
};

function billingPayload(invoices: Record<string, unknown>[] = [{ ...UNPAID_INVOICE }]) {
  return { success: true, data: { ...BASE_BILLING, invoices } };
}

const CHECKOUT_OK = {
  success: true,
  data: { invoice_number: "INV-202610-0001", payment_url: "https://sandbox.doku.com/checkout/test-page" },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "w1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/v1/billing", (route) => route.fulfill({ json: billingPayload() }));
  await page.route("https://sandbox.doku.com/**", (route) => route.fulfill({ body: "DOKU sandbox (mocked)" }));
});

test.describe("DOKU checkout from billing page (mocked API)", () => {
  test("checkout called exactly once and browser navigates to payment_url", async ({ page }) => {
    let checkoutCalls = 0;
    await page.route("**/api/v1/billing/doku/checkout", (route) => {
      checkoutCalls += 1;
      route.fulfill({ json: CHECKOUT_OK });
    });

    await page.goto("/billing");
    const btn = page.getByRole("button", { name: "Bayar dengan DOKU" });
    await expect(btn).toBeVisible();
    await btn.click();

    await expect(page).toHaveURL(/sandbox\.doku\.com/);
    expect(checkoutCalls).toBe(1);
  });

  test("button disabled while pending — double-click sends one request", async ({ page }) => {
    let checkoutCalls = 0;
    await page.route("**/api/v1/billing/doku/checkout", async (route) => {
      checkoutCalls += 1;
      await new Promise((r) => setTimeout(r, 800));
      route.fulfill({ json: CHECKOUT_OK });
    });

    await page.goto("/billing");
    const btn = page.getByRole("button", { name: "Bayar dengan DOKU" });
    await btn.click();
    await expect(btn).toBeDisabled();
    await btn.click({ force: true }).catch(() => undefined);

    await expect(page).toHaveURL(/sandbox\.doku\.com/, { timeout: 5000 });
    expect(checkoutCalls).toBe(1);
  });

  test("displays clear error on DOKU_NOT_CONFIGURED", async ({ page }) => {
    await page.route("**/api/v1/billing/doku/checkout", (route) =>
      route.fulfill({ status: 503, json: { success: false, error: { code: "DOKU_NOT_CONFIGURED", message: "Pembayaran DOKU belum dikonfigurasi." } } }),
    );

    await page.goto("/billing");
    await page.getByRole("button", { name: "Bayar dengan DOKU" }).click();
    await expect(page.getByText("Pembayaran online belum tersedia di server ini.")).toBeVisible();
  });

  test("displays clear error on DOKU_CHECKOUT_FAILED", async ({ page }) => {
    await page.route("**/api/v1/billing/doku/checkout", (route) =>
      route.fulfill({ status: 502, json: { success: false, error: { code: "DOKU_CHECKOUT_FAILED", message: "DOKU menolak." } } }),
    );

    await page.goto("/billing");
    await page.getByRole("button", { name: "Bayar dengan DOKU" }).click();
    await expect(page.getByText("DOKU menolak permintaan checkout. Coba lagi nanti.")).toBeVisible();
  });

  test("?doku=success with unpaid invoice shows 'menunggu konfirmasi' and cleans URL", async ({ page }) => {
    await page.goto("/billing?doku=success");
    await expect(page.getByText("Menunggu konfirmasi pembayaran")).toBeVisible();
    await expect(page).toHaveURL(/\/billing$/);
  });

  test("?doku=cancel shows 'dibatalkan' banner and cleans URL", async ({ page }) => {
    await page.goto("/billing?doku=cancel");
    await expect(page.getByText("Pembayaran dibatalkan")).toBeVisible();
    await expect(page).toHaveURL(/\/billing$/);
  });

  test("?doku=success with no invoices at all shows 'menunggu konfirmasi', never 'dikonfirmasi'", async ({ page }) => {
    await page.route("**/api/v1/billing", (route) => route.fulfill({ json: billingPayload([]) }));
    await page.goto("/billing?doku=success");
    await expect(page.getByText("Menunggu konfirmasi pembayaran")).toBeVisible();
    await expect(page.getByText("Pembayaran dikonfirmasi")).not.toBeVisible();
  });

  test("?doku=success with only void invoices shows 'menunggu konfirmasi'", async ({ page }) => {
    await page.route("**/api/v1/billing", (route) => route.fulfill({ json: billingPayload([VOID_INVOICE]) }));
    await page.goto("/billing?doku=success");
    await expect(page.getByText("Menunggu konfirmasi pembayaran")).toBeVisible();
  });

  test("?doku=success with old paid invoice but checkout invoice still unpaid shows 'menunggu konfirmasi' inside payment card", async ({ page }) => {
    await page.route("**/api/v1/billing", (route) => route.fulfill({ json: billingPayload([UNPAID_INVOICE, PAID_INVOICE]) }));
    await page.goto("/billing?doku=success");
    await expect(page.getByText("Menunggu konfirmasi pembayaran")).toBeVisible();
    await expect(page.getByRole("button", { name: "Bayar dengan DOKU" })).toBeVisible();
  });

  test("?doku=success with server-confirmed paid invoice shows 'menunggu konfirmasi' (redirect is never proof)", async ({ page }) => {
    const paidCheckout = { ...UNPAID_INVOICE, status: "paid", paid_at: "2026-10-08T12:00:00Z", method: "doku", reference: "req-abc" };
    await page.route("**/api/v1/billing", (route) => route.fulfill({ json: billingPayload([paidCheckout]) }));
    await page.goto("/billing?doku=success");
    await expect(page.getByText("Menunggu konfirmasi pembayaran")).toBeVisible();
    await expect(page.getByText("Pembayaran dikonfirmasi")).not.toBeVisible();
  });

  test("DOKU section explains webhook verification; manual transfer section has 'kirim bukti'", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByText("diverifikasi DOKU")).toBeVisible();
    await expect(page.getByText("tidak perlu mengirim bukti")).toBeVisible();
    const manualSection = page.getByText("Atau transfer manual").locator("..");
    await expect(manualSection.getByText("kirim bukti pembayaran")).toBeVisible();
  });
});
