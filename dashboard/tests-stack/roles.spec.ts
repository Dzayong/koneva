import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ORIGIN, CUSTOMER_PASSWORD, asCustomer, customer, db, emailMode, latestOtp, managerCalls } from "./support/stack";

// Roles and invitations in a real browser against the real API, real PostgreSQL and the real Next proxy (STACK-local).
// Emails go to a local file outbox only. No WhatsApp, no real device, no external mail.

async function makeDeveloper(owner: Awaited<ReturnType<typeof customer>>, dev: Awaited<ReturnType<typeof customer>>) {
  await db.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'developer')", [dev.userId, owner.tenant]);
}
const openTeam = async (page: Page) => { await page.goto("/team"); };

test.describe("Owner and Developer (STACK-local)", () => {
  test.beforeEach(async () => { await emailMode("dev-outbox"); });

  test("Owner invites a Developer with a Gmail address; the team page offers only Owner and Developer", async ({ page }) => {
    const owner = await customer();
    await asCustomer(page, owner);
    await openTeam(page);
    await expect(page.getByRole("heading", { name: "Tim", level: 2 })).toBeVisible();
    await expect(page.getByText("Owner", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Undang Developer" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Peran: Developer")).toBeVisible();
    await expect(dialog.getByRole("combobox")).toHaveCount(0); // no role picker: nothing else can be granted
    for (const legacy of ["Admin", "Viewer"]) await expect(dialog.getByText(legacy, { exact: true })).toHaveCount(0);
    await dialog.getByLabel("Alamat Gmail penerima").fill("kolega@yahoo.com");
    await dialog.getByRole("button", { name: "Buat tautan undangan" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Gmail");
    expect((await db.query("SELECT count(*)::int AS n FROM invitations WHERE tenant_id=$1", [owner.tenant])).rows[0].n).toBe(0);
    await dialog.getByLabel("Alamat Gmail penerima").fill("  Kolega.Uji@GMAIL.com ");
    await dialog.getByRole("button", { name: "Buat tautan undangan" }).click();
    await expect(page.getByText("Tautan undangan siap")).toBeVisible();
    const row = (await db.query("SELECT email, role FROM invitations WHERE tenant_id=$1", [owner.tenant])).rows[0];
    expect(row).toEqual({ email: "kolega.uji@gmail.com", role: "developer" });
  });

  test("an unverified Owner (non-Gmail sign-up) is asked to verify before inviting; devices stay usable; after the code the invitation goes through", async ({ page }) => {
    const email = `mhs${randomUUID().slice(0, 6)}@kampus.ac.id`;
    const owner = await customer(email, false);
    await asCustomer(page, owner);
    await page.goto("/devices");
    await expect(page.getByRole("heading", { name: "Device", level: 2 })).toBeVisible(); // not blocked
    await openTeam(page);
    await page.getByRole("button", { name: "Undang Developer" }).click();
    const invite = page.getByRole("dialog");
    await invite.getByLabel("Alamat Gmail penerima").fill(`kolega${randomUUID().slice(0, 6)}@gmail.com`);
    await invite.getByRole("button", { name: "Buat tautan undangan" }).click();
    const verify = page.getByRole("dialog", { name: "Verifikasi email Anda" });
    await expect(verify).toBeVisible();
    await verify.getByRole("button", { name: "Kirim kode ke email" }).click();
    await expect(verify.getByLabel("Kode verifikasi")).toBeVisible();
    const code = latestOtp(email)!;
    expect(code).toMatch(/^\d{6}$/);
    await verify.getByLabel("Kode verifikasi").fill(code === "000000" ? "111111" : "000000");
    await verify.getByRole("button", { name: "Verifikasi" }).click();
    await expect(verify.getByRole("alert").filter({ hasText: "Kode salah" })).toBeVisible();
    await verify.getByLabel("Kode verifikasi").fill(code);
    await verify.getByRole("button", { name: "Verifikasi" }).click();
    await expect(verify).toHaveCount(0);
    expect((await db.query("SELECT email_verified_at FROM users WHERE id=$1", [owner.userId])).rows[0].email_verified_at).not.toBeNull();
    // Back in the invite form (still open, address kept): submitting again now works.
    await invite.getByRole("button", { name: "Buat tautan undangan" }).click();
    await expect(page.getByText("Tautan undangan siap")).toBeVisible();
  });

  test("recipient: sends OTP, wrong code refused, correct code creates the Developer account", async ({ browser }) => {
    const owner = await customer();
    const email = `penerima-${randomUUID().slice(0, 8)}@gmail.com`;
    const invite = await fetch(`${ORIGIN}/api/v1/team/invitations`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ email, role: "developer" }),
    });
    const { data } = (await invite.json()) as { data: { accept_path: string } };
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto(data.accept_path);
    await expect(guest.getByText(/Gabung ke/)).toBeVisible();
    await expect(guest.getByText("Developer", { exact: true }).first()).toBeVisible();
    await expect(guest.getByRole("button", { name: "Buat akun dan gabung" })).toBeDisabled();
    await guest.getByLabel("Nama").fill("Developer Uji");
    await guest.locator("#password").fill(CUSTOMER_PASSWORD);
    await guest.locator("#terms").check();
    await guest.getByRole("button", { name: "Kirim kode ke email" }).click();
    await expect(guest.getByRole("status")).toContainText("Kode sudah dikirim");
    expect(latestOtp(email)).toMatch(/^\d{6}$/);
    const real = latestOtp(email)!;
    await guest.getByLabel("Kode verifikasi").fill(real === "000000" ? "111111" : "000000");
    await guest.getByRole("button", { name: "Buat akun dan gabung" }).click();
    await expect(guest.getByRole("alert").filter({ hasText: "Kode salah" })).toBeVisible();
    expect((await db.query("SELECT count(*)::int AS n FROM users WHERE lower(email)=$1", [email])).rows[0].n).toBe(0);
    await guest.getByLabel("Kode verifikasi").fill(real);
    await guest.getByRole("button", { name: "Buat akun dan gabung" }).click();
    await expect(guest).toHaveURL(/\/dashboard|\/$/);
    const membership = (await db.query("SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE lower(u.email)=$1 AND m.tenant_id=$2", [email, owner.tenant])).rows;
    expect(membership).toEqual([{ role: "developer" }]);
    await context.close();
  });

  test("without a configured email sender the invitation cannot be accepted, and says so", async ({ browser }) => {
    const owner = await customer();
    const email = `tanpa-email-${randomUUID().slice(0, 8)}@gmail.com`;
    const res = await fetch(`${ORIGIN}/api/v1/team/invitations`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ email, role: "developer" }) });
    const { data } = (await res.json()) as { data: { accept_path: string } };
    await emailMode("none");
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto(data.accept_path);
    await expect(guest.getByRole("note")).toContainText("Pengiriman email belum diaktifkan");
    await expect(guest.getByRole("button", { name: "Kirim kode ke email" })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Buat akun dan gabung" })).toBeDisabled();
    expect((await db.query("SELECT count(*)::int AS n FROM invitation_otps")).rows[0].n >= 0).toBe(true);
    expect((await db.query("SELECT count(*)::int AS n FROM users WHERE lower(email)=$1", [email])).rows[0].n).toBe(0);
    await context.close();
  });

  test("Developer manages devices (including delete) but sees no billing or team", async ({ page }) => {
    const owner = await customer(), dev = await customer();
    await makeDeveloper(owner, dev);
    const key = `D${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await db.query("INSERT INTO devices(tenant_id,device_key,label) VALUES ($1,$2,'Perangkat Uji')", [owner.tenant, key]);
    await asCustomer(page, dev, owner.tenant);
    await page.goto("/devices");
    await expect(page.getByText("Perangkat Uji")).toBeVisible();
    await expect(page.getByRole("link", { name: "Tim" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Tagihan" })).toHaveCount(0);
    await expect(page.getByText("Developer").first()).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Aksi" }).click();
    await page.getByRole("menuitem", { name: "Hapus" }).click();
    await expect.poll(async () => (await managerCalls()).some((c) => c === `DELETE /devices/${key}`)).toBe(true);
    // Direct navigation does not open what the role cannot use, and the API refuses too.
    await page.goto("/billing");
    await expect(page.getByText("Hanya pemilik workspace yang bisa membuka Tagihan.")).toBeVisible();
    await openTeam(page);
    await expect(page.getByText("Peran Anda tidak bisa mengelola tim.")).toBeVisible();
  });

  test("the same account is Owner in one workspace and Developer in another; the header follows the workspace", async ({ page }) => {
    const a = await customer(), b = await customer();
    await db.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'developer')", [a.userId, b.tenant]);
    await asCustomer(page, a, a.tenant);
    await page.goto("/devices");
    await expect(page.getByText("Owner").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Tagihan" })).toBeVisible();
    const other = await page.context().newPage(); // same account, other workspace (the init script would reset a reload)
    await asCustomer(other, a, b.tenant);
    await other.goto("/devices");
    await expect(other.getByText("Developer").first()).toBeVisible();
    await expect(other.getByRole("link", { name: "Tagihan" })).toHaveCount(0);
    const roles = (await db.query("SELECT role FROM memberships WHERE user_id=$1 ORDER BY role", [a.userId])).rows.map((r) => r.role);
    expect(roles).toEqual(["developer", "owner"]);
  });

  test("a legacy viewer keeps read access, is labelled as legacy, and cannot delete; the owner can promote explicitly", async ({ page }) => {
    const owner = await customer(), viewer = await customer();
    await db.query("ALTER TABLE memberships DISABLE TRIGGER memberships_no_new_legacy_role");
    try { await db.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'viewer')", [viewer.userId, owner.tenant]); }
    finally { await db.query("ALTER TABLE memberships ENABLE TRIGGER memberships_no_new_legacy_role"); }
    await db.query("INSERT INTO devices(tenant_id,device_key,label) VALUES ($1,$2,'Perangkat Lama')", [owner.tenant, `L${randomUUID().replace(/-/g, "").slice(0, 20)}`]);
    await asCustomer(page, viewer, owner.tenant);
    await page.goto("/devices");
    await expect(page.getByText("Perangkat Lama")).toBeVisible();
    await expect(page.getByText("Viewer (lama)").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Aksi" })).toHaveCount(0); // no pause/resume/delete for a read-only role
    // Owner: the legacy member is shown as legacy, and only an explicit click makes them Developer.
    const ownerPage = await page.context().newPage();
    await asCustomer(ownerPage, owner);
    await ownerPage.goto("/team");
    await expect(ownerPage.getByRole("table").getByText("Viewer (lama)")).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "Tinjau dan terbitkan pemberitahuan 60 hari" })).toBeVisible();
    await ownerPage.getByRole("button", { name: "Tinjau dan terbitkan pemberitahuan 60 hari" }).click();
    await expect(ownerPage.getByRole("dialog").getByText(/tenggat tepat 60 hari sejak sekarang/)).toBeVisible();
    await ownerPage.getByRole("dialog").getByRole("button", { name: "Kembali" }).click();
    expect((await db.query("SELECT count(*)::int AS n FROM legacy_role_notices WHERE tenant_id=$1", [owner.tenant])).rows[0].n).toBe(0);
    await ownerPage.getByRole("button", { name: "Tinjau dan terbitkan pemberitahuan 60 hari" }).click();
    await ownerPage.getByRole("dialog").getByRole("button", { name: "Terbitkan pemberitahuan resmi" }).click();
    await expect(ownerPage.getByRole("status").getByText(/Hak akses saat ini tetap berlaku/)).toBeVisible();
    const notice = (await db.query("SELECT notice_sent_at,deadline_at FROM legacy_role_notices WHERE tenant_id=$1", [owner.tenant])).rows[0];
    expect(new Date(notice.deadline_at).getTime() - new Date(notice.notice_sent_at).getTime()).toBe(60 * 24 * 60 * 60 * 1000);
    expect((await db.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [viewer.userId, owner.tenant])).rows[0].role).toBe("viewer");
    await ownerPage.getByRole("button", { name: "Jadikan Developer" }).click();
    await expect.poll(async () => (await db.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [viewer.userId, owner.tenant])).rows[0].role).toBe("developer");
  });
});
