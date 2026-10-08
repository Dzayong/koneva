import { expect, test } from "@playwright/test";

/**
 * UI evidence (mocked API, no backend/DB/WhatsApp) that the "Mulai cepat" send form never fires
 * POST /api/v1/message/send until the confirmation dialog is explicitly accepted — "Batal" or simply
 * not confirming must leave zero send calls; "Ya, kirim sekarang" must fire exactly one.
 */

const ME = {
  success: true,
  data: {
    user: { id: "u1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
    workspace: { id: "w1", name: "Workspace Uji", role: "owner" },
    workspaces: [{ id: "w1", name: "Workspace Uji", role: "owner" }],
    permissions: ["devices:read", "devices:write", "messages:read", "messages:send", "content:write"],
    subscription: null,
    support_contact: null,
  },
};

const DEVICE = {
  id: "d1",
  device_key: "WAPI-TESTDEVICE",
  phone_number: "6281200000000",
  label: "Device Uji",
  status: "online",
  qr_code: null,
  health_score: 80,
  last_connected: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const HEALTH = {
  success: true,
  data: {
    health_score: 80,
    device_age_days: 30,
    warmup_completed: true,
    warmup_day: 30,
    metrics: { total_sent: 10, delivered: 10, replied: 2, blocked: 0, reported: 0 },
    rates: { delivery: 1, reply: 0.2, block: 0, report: 0 },
    breakdown: [],
    missions: [],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "w1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/v1/devices", (route) => route.fulfill({ json: { success: true, data: [DEVICE] } }));
  await page.route("**/api/v1/devices/*/health", (route) => route.fulfill({ json: HEALTH }));
});

test("the confirm dialog gates the send: no network call before confirming, exactly one after", async ({ page }) => {
  let sendCalls = 0;
  await page.route("**/api/v1/message/send", (route) => {
    sendCalls += 1;
    route.fulfill({ json: { success: true, data: { message_id: "11111111-1111-4111-8111-111111111111", status: "queued" }, message_id: "11111111-1111-4111-8111-111111111111", status: "queued" } });
  });
  await page.route("**/api/v1/messages/11111111-1111-4111-8111-111111111111", (route) =>
    route.fulfill({ json: { success: true, data: { id: "11111111-1111-4111-8111-111111111111", status: "sent", error_message: null, created_at: new Date().toISOString() } } }),
  );

  await page.goto("/developers/quickstart");
  await page.getByLabel("Nomor tujuan").fill("6281234567890");

  // Trigger the form's submit button ("Tinjau dan kirim") — must open the dialog, not send yet.
  await page.getByRole("button", { name: "Tinjau dan kirim" }).click();
  await expect(page.getByRole("dialog", { name: /Konfirmasi kirim pesan WhatsApp sungguhan/i })).toBeVisible();
  expect(sendCalls).toBe(0);

  // Cancelling must never send.
  await page.getByRole("button", { name: "Batal" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(sendCalls).toBe(0);

  // Re-open and actually confirm: exactly one send call.
  await page.getByRole("button", { name: "Tinjau dan kirim" }).click();
  await page.getByRole("button", { name: "Ya, kirim sekarang" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect.poll(() => sendCalls).toBe(1);

  // No matter how long we wait, still exactly one call (no accidental double-submit).
  await page.waitForTimeout(500);
  expect(sendCalls).toBe(1);
});
