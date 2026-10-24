import { expect, test } from "@playwright/test";

test("auto-reply form offers fixed, general AI, and instructed AI modes", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "w1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: {
    success: true,
    data: {
      user: { id: "u1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
      workspace: { id: "w1", name: "Workspace Uji", role: "owner" },
      workspaces: [{ id: "w1", name: "Workspace Uji", role: "owner" }],
      permissions: ["devices:read", "devices:write", "messages:read", "messages:send", "content:write", "team:manage", "billing:manage"],
      subscription: null, support_contact: null,
    },
  } }));
  await page.route("**/api/v1/devices", (route) => route.fulfill({ json: { success: true, data: [
    { id: "d1", device_key: "WAPI-X", label: "Device Uji", phone_number: null, status: "online", health_score: 90 },
  ] } }));
  await page.route("**/api/v1/auto-reply-rules**", (route) => route.fulfill({ json: {
    success: true, data: [], pagination: { limit: 20, offset: 0, total: 0, has_more: false },
  } }));

  await page.goto("/settings/auto-reply");
  await page.getByRole("button", { name: "Tambah aturan" }).click();
  await page.getByText("Pilih device").click();
  await page.getByRole("option", { name: "Device Uji" }).click();

  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "AI umum" }).click();
  await expect(page.getByLabel("Isi balasan")).toHaveCount(0);
  await expect(page.getByLabel("Deskripsi peran dan aturan AI")).toHaveCount(0);

  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "AI dengan instruksi dan skill" }).click();
  await expect(page.getByLabel("Instruksi tambahan (opsional jika memilih skill)")).toBeVisible();
  await expect(page.getByText("Skill balasan")).toBeVisible();

  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "Balasan tetap" }).click();
  await expect(page.getByLabel("Isi balasan")).toBeVisible();
});
