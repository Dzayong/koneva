import { expect, test } from "@playwright/test";

const ME = {
  success: true,
  data: {
    user: { id: "u1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
    workspace: { id: "w1", name: "Workspace Uji", role: "owner" },
    workspaces: [{ id: "w1", name: "Workspace Uji", role: "owner" }],
    permissions: ["devices:read", "devices:write", "messages:read", "messages:send", "contacts:read"],
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "w1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/v1/devices", (route) => route.fulfill({ json: { success: true, data: [DEVICE] } }));
  await page.route("**/api/v1/contacts**", (route) =>
    route.fulfill({ json: { data: [], pagination: { limit: 100, offset: 0, total: 0 } } }),
  );
  await page.route("**/api/v1/contacts/broadcast-consent", (route) =>
    route.fulfill({ json: { success: true, data: { recorded: 1 } } }),
  );
});

async function prepareBroadcast(page: import("@playwright/test").Page, recipients: string, confirmConsent = true) {
  await page.goto("/broadcast");
  await page.getByText("Pilih device yang online").click();
  await page.getByRole("option", { name: /Device Uji/ }).click();
  await page.getByLabel("Templat pesan").fill("Pesan uji");
  await page.getByLabel("Atau tempel nomor telepon (satu per baris)").fill(recipients);
  if (confirmConsent) await page.getByRole("checkbox", { name: "Konfirmasi izin penerima" }).check();
  await page.getByRole("button", { name: "Kirim broadcast" }).click();
}

test("broadcast requires the sender's consent confirmation before any send", async ({ page }) => {
  let consentCalls = 0;
  let sendCalls = 0;
  await page.route("**/api/v1/contacts/broadcast-consent", (route) => { consentCalls++; return route.fulfill({ json: { success: true, data: { recorded: 1 } } }); });
  await page.route("**/api/v1/message/send", (route) => { sendCalls++; return route.fulfill({ json: { success: true, message_id: "m1", status: "queued" } }); });

  await prepareBroadcast(page, "6281234567890", false);
  await expect(page.getByText("Konfirmasi izin penerima dulu")).toBeVisible();
  expect(consentCalls).toBe(0);
  expect(sendCalls).toBe(0);
});

test("opted-out recipient blocks the entire broadcast before any message is queued", async ({ page }) => {
  let sendCalls = 0;
  await page.route("**/api/v1/contacts/broadcast-consent", (route) =>
    route.fulfill({ status: 409, json: { success: false, error: { code: "RECIPIENT_OPTED_OUT", message: "Some recipients opted out" } } }),
  );
  await page.route("**/api/v1/message/send", (route) => { sendCalls++; return route.fulfill({ json: { success: true, message_id: "m1", status: "queued" } }); });

  await prepareBroadcast(page, "6281234567890");
  await expect(page.getByText("Tidak ada pesan yang dikirim", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications alt+T" }).getByText(/pernah meminta berhenti/)).toBeVisible();
  expect(sendCalls).toBe(0);
});

test("all rejected recipients produce an error result, never a success toast", async ({ page }) => {
  await page.route("**/api/v1/message/send", (route) =>
    route.fulfill({
      status: 409,
      json: { success: false, error: { code: "RECIPIENT_CONSENT_REQUIRED", message: "Consent required" } },
    }),
  );

  await prepareBroadcast(page, "6281234567890\n6281234567891");

  await expect(page.getByText("Tidak ada pesan yang masuk antrean")).toBeVisible();
  await expect(page.getByText("0 masuk antrean · 0 ditahan karena kuota · 2 gagal")).toBeVisible();
  await expect(page.getByText("Broadcast selesai", { exact: true })).toHaveCount(0);
});

test("mixed queued, quota-held, and rejected recipients are reported separately", async ({ page }) => {
  let call = 0;
  await page.route("**/api/v1/message/send", (route) => {
    call++;
    if (call === 1) {
      return route.fulfill({ json: { success: true, message_id: "m1", status: "queued" } });
    }
    if (call === 2) {
      return route.fulfill({ json: { success: true, message_id: "m2", status: "quota_hold" } });
    }
    return route.fulfill({
      status: 409,
      json: { success: false, error: { code: "RECIPIENT_CONSENT_REQUIRED", message: "Consent required" } },
    });
  });

  await prepareBroadcast(page, "6281234567890\n6281234567891\n6281234567892");

  await expect(page.getByText("Broadcast selesai dengan kendala")).toBeVisible();
  await expect(page.getByText("1 masuk antrean · 1 ditahan karena kuota · 1 gagal")).toBeVisible();
  await expect(page.getByText("Masuk antrean", { exact: true })).toBeVisible();
  await expect(page.getByText("Ditahan: kuota habis")).toBeVisible();
});

test("all accepted recipients are described as queued, not delivered", async ({ page }) => {
  await page.route("**/api/v1/message/send", (route) =>
    route.fulfill({ json: { success: true, message_id: "m1", status: "queued" } }),
  );

  await prepareBroadcast(page, "6281234567890");

  await expect(page.getByText("Semua pesan masuk antrean")).toBeVisible();
  await expect(page.getByText("1 masuk antrean · 0 ditahan karena kuota · 0 gagal")).toBeVisible();
  await expect(page.getByText("Masuk antrean", { exact: true })).toBeVisible();
});
