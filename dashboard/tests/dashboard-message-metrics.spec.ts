import { expect, test } from "@playwright/test";

const ME = {
  success: true,
  data: {
    user: { id: "u1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
    workspace: { id: "w1", name: "Workspace Uji", role: "owner" },
    workspaces: [{ id: "w1", name: "Workspace Uji", role: "owner" }],
    permissions: ["devices:read", "messages:read", "inbox:read", "messages:reply", "contacts:read"],
    subscription: null,
    support_contact: null,
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "w1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/v1/devices", (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route("**/api/v1/contacts**", (route) =>
    route.fulfill({ json: { data: [], pagination: { limit: 100, offset: 0, total: 0 } } }),
  );
});

test("dashboard uses the server's complete WIB daily count, not a 100-message page sample", async ({ page }) => {
  await page.route("**/api/v1/dashboard/stats", (route) =>
    route.fulfill({ json: { success: true, data: { messages_today: 7, delivery_rate: 83.33 } } }),
  );

  await page.goto("/dashboard");

  await expect(page.getByText("Pesan hari ini")).toBeVisible();
  await expect(page.getByText("Masuk + keluar, semua status, sejak 00.00 WIB")).toBeVisible();
  await expect(page.getByText("7", { exact: true })).toBeVisible();
  await expect(page.getByText("Tingkat pengantaran")).toBeVisible();
  await expect(page.getByText("83.3%")).toBeVisible();
});

test("Inbox groups messages into a conversation and displays its chat history", async ({ page }) => {
  const createdAt = new Date().toISOString();
  const chatKey = "6281234567890@s.whatsapp.net";
  await page.route("**/api/v1/inbox/devices", (route) =>
    route.fulfill({ json: { success: true, data: [{ device_key: "WAPI-X", label: "Device Uji", phone_number: null, status: "online" }] } }),
  );
  await page.route("**/api/v1/inbox/conversations**", (route) =>
    route.fulfill({
      json: {
        data: [{
          latest_message_id: "m2", device_key: "WAPI-X", device_label: "Device Uji", chat_key: chatKey,
          chat_jid: chatKey, peer_number: "6281234567890", direction: "inbound", content: "Halo, saya perlu bantuan",
          type: "text", status: "received", created_at: createdAt, message_count: 2,
        }],
        pagination: { limit: 100, offset: 0, total: 1, has_more: false },
      },
    }),
  );
  await page.route("**/api/v1/inbox/messages**", (route) =>
    route.fulfill({
      json: {
        data: [
          { id: "m1", tenant_id: "t1", device_id: "d1", device_key: "WAPI-X", direction: "outbound", from_number: null, to_number: "6281234567890", chat_jid: chatKey, content: "Halo! Ada yang bisa dibantu?", type: "text", status: "delivered", external_id: null, error_message: null, created_at: createdAt, sent_at: createdAt, delivered_at: createdAt, read_at: null },
          { id: "m2", tenant_id: "t1", device_id: "d1", device_key: "WAPI-X", direction: "inbound", from_number: "6281234567890", to_number: "6280000000000", chat_jid: chatKey, content: "Halo, saya perlu bantuan", type: "text", status: "received", external_id: null, error_message: null, created_at: createdAt, sent_at: null, delivered_at: null, read_at: null },
        ],
        pagination: { limit: 100, offset: 0, total: 2, has_more: false },
      },
    }),
  );

  await page.goto("/messages");

  await expect(page.getByText("Percakapan", { exact: true })).toBeVisible();
  await expect(page.getByText("+62 812-3456-7890", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Halo! Ada yang bisa dibantu?", { exact: true })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Halo, saya perlu bantuan" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Pilih device" })).toContainText("Semua device");
});
