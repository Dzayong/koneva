import { expect, test } from "@playwright/test";

const ME = {
  success: true,
  data: {
    user: { id: "u1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
    workspace: { id: "w1", name: "Workspace Uji", role: "owner" },
    workspaces: [{ id: "w1", name: "Workspace Uji", role: "owner" }],
    permissions: ["contacts:read", "contacts:write"],
    subscription: null,
    support_contact: null,
  },
};

const contacts = [
  { id: "contact-1", name: "Pelanggan Satu", phone_number: "6281200000001", tags: [], notes: null },
  { id: "contact-2", name: "Pelanggan Dua", phone_number: "6281200000002", tags: [], notes: null },
];

test("saving group members refreshes the member list and persists after reload", async ({ page }) => {
  let memberIds: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "w1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/v1/contacts**", (route) =>
    route.fulfill({ json: { success: true, data: contacts, pagination: { total: contacts.length, limit: 20, offset: 0, has_more: false } } }),
  );
  await page.route("**/api/v1/contact-groups", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, json: { success: true, data: { id: "group-1", name: "Pelanggan", member_count: 0 } } });
    }
    return route.fulfill({ json: { success: true, data: [{ id: "group-1", name: "Pelanggan", member_count: memberIds.length }] } });
  });
  await page.route("**/api/v1/contact-groups/group-1/members", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { contact_ids: string[] };
      memberIds = body.contact_ids;
      return route.fulfill({ json: { success: true, data: { group_id: "group-1", member_count: memberIds.length } } });
    }
    return route.fulfill({ json: { success: true, data: contacts.filter((contact) => memberIds.includes(contact.id)) } });
  });

  await page.goto("/contacts");
  await page.getByRole("combobox", { name: "Pilih grup kontak" }).selectOption("group-1");
  await expect(page.getByText("0 kontak tersimpan di grup ini.")).toBeVisible();
  await page.getByRole("button", { name: "Tambahkan 2 kontak halaman ini" }).click();
  await expect(page.getByText("2 kontak tersimpan di grup ini.")).toBeVisible();
  await expect(page.getByText("Anggota grup disimpan")).toBeVisible();

  await page.reload();
  await page.getByRole("combobox", { name: "Pilih grup kontak" }).selectOption("group-1");
  await expect(page.getByText("2 kontak tersimpan di grup ini.")).toBeVisible();
});
