import { expect, test } from "@playwright/test";

const ME = {
  success: true,
  data: {
    user: { id: "u1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
    workspace: { id: "w1", name: "Workspace Uji", role: "owner" },
    workspaces: [{ id: "w1", name: "Workspace Uji", role: "owner" }],
    permissions: ["devices:read", "messages:read", "contacts:read"],
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

test("message history can use the exact same today-in-WIB date window", async ({ page }) => {
  let todayRequest = false;
  await page.route("**/api/v1/messages**", (route) => {
    const url = new URL(route.request().url());
    todayRequest = url.searchParams.get("created_today") === "true";
    route.fulfill({ json: { data: [], pagination: { limit: 20, offset: 0, total: todayRequest ? 7 : 30 } } });
  });

  await page.goto("/messages");
  await page.getByRole("combobox", { name: "Rentang waktu" }).click();
  await page.getByRole("option", { name: "Hari ini (WIB)" }).click();

  await expect.poll(() => todayRequest).toBe(true);
  await expect(page.getByText("Halaman 1 dari 1 · 7 total")).toBeVisible();
  await expect(page.getByText("Pilih “Hari ini (WIB)” untuk melihat cakupan waktu yang sama.")).toBeVisible();
});
