import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ORIGIN, asCustomer, db, type Customer } from "./support/stack";
import { signup } from "../../src/api-gateway/services/account.service";

// T1.1 catalog, annual-close, grandfather and quota-hold meter, in a real browser against the real API,
// real PostgreSQL and the real Next proxy (STACK-local). No WhatsApp, no real device, no email sent.
//
// Signs up through the account.service.ts function directly rather than support/stack.ts's customer()
// (which goes through the real, rate-limited /auth/signup HTTP route): tests-stack/roles.spec.ts already uses
// exactly the "10 per hour per IP" signup budget on its own (see docs/API.md), so any other file's real HTTP
// signups reliably tip that shared, in-memory, per-process limiter over -- this is a pre-existing fragility of
// the suite's signup budget, not something these tests are meant to exercise. Calling the service function
// skips only the rate-limit middleware; the same INSERTs run either way.
async function directCustomer(email = `${randomUUID()}@gmail.com`): Promise<Customer> {
  const result = await signup({ email, password: "synthetic-customer-pass-26", name: "Pemilik Uji" }, {});
  const tenant = result.workspaces[0]!.id;
  await db.query("UPDATE users SET email_verified_at = now() WHERE id=$1", [result.user.id]);
  await db.query("UPDATE subscriptions SET plan_id='umkm', status='active', period_end=now()+interval '30 days' WHERE tenant_id=$1", [tenant]);
  return { email, token: result.token, userId: result.user.id, tenant };
}

test.describe("T1.1 plans, quota and grandfather (STACK-local)", () => {
  test("public plan catalog: four monthly plans, stable ids, Bisnis CS shows the Unlimited* headline and fair-use note", async () => {
    const res = await fetch(`${ORIGIN}/public/plans`);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    const byId = Object.fromEntries(body.data.map((p) => [p.id, p]));
    expect(byId["pelajar"]).toMatchObject({ name: "Pelajar", price_month_idr: 29000, monthly_messages: 1000, max_devices: 1, max_members: 1 });
    expect(byId["asisten"]).toMatchObject({ name: "Asisten Pribadi", price_month_idr: 59000, monthly_messages: 5000, max_devices: 1, max_members: 1 });
    expect(byId["umkm"]).toMatchObject({ name: "Tim UKM", price_month_idr: 99000, monthly_messages: 10000, max_devices: 3, max_members: 3 });
    const tim = byId["tim"] as { price_month_idr: number; monthly_messages: number; quota_headline: string; quota_note: string };
    expect(tim.price_month_idr).toBe(199000);
    expect(tim.monthly_messages).toBe(20000); // real enforced cap, even though the headline says Unlimited
    expect(tim.quota_headline).toContain("Unlimited");
    expect(tim.quota_note).toContain("20.000");
  });

  test("annual checkout is closed for new orders: the API refuses yearly and the billing page never offers a cycle toggle", async ({ page }) => {
    const owner = await directCustomer();
    const res = await fetch(`${ORIGIN}/api/v1/billing/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}`, "x-workspace": owner.tenant },
      body: JSON.stringify({ plan: "umkm", cycle: "yearly" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ANNUAL_CHECKOUT_CLOSED");

    await asCustomer(page, owner);
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Pilih atau ganti paket" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Siklus tagihan" })).toHaveCount(0);
    await expect(page.getByText("Tahunan", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Checkout tahunan sudah ditutup")).toBeVisible();
  });

  test("grandfather price on renewal, and the held-message meter, on the same workspace (one signup for both)", async ({ page }) => {
    const owner = await directCustomer();

    // ---- grandfather: an existing Pelajar subscriber's own order still shows the old 19.000 ----
    await db.query(
      `UPDATE subscriptions SET plan_id='pelajar', status='active', period_end=now()+interval '20 days', price_override_idr=19000 WHERE tenant_id=$1`,
      [owner.tenant],
    );
    await db.query("UPDATE tenants SET student_verified_at = now() WHERE id=$1", [owner.tenant]); // pelajar still needs verification
    await asCustomer(page, owner);
    await page.goto("/billing");
    // Only the tenant's OWN current plan card ever renders "Perpanjang" (every other card says "Pilih paket").
    await page.getByRole("button", { name: "Perpanjang" }).click();
    await expect(page.getByText("Tagihan INV-")).toBeVisible();
    // The invoice HISTORY table below also gets a "Rp 19.000" row for this same new invoice, so this reads the
    // specific amount paragraph the Payment panel renders right after "Tagihan INV-...", not just any match.
    const amountLine = page.getByText("Tagihan INV-").locator("xpath=following-sibling::p[1]");
    await expect(amountLine).toHaveText("Rp 19.000");
    const invoice = (await db.query("SELECT amount_idr FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1", [owner.tenant])).rows[0];
    expect(invoice.amount_idr).toBe(19000); // the grandfathered 19.000, never the new 29.000 catalog price

    // ---- quota hold: the meter shows a held message with a clear upgrade path, not a silent failure ----
    // The send pipeline itself (queueMessage -> quota_hold, never dropped) is already proven end-to-end with a
    // real device/Redis in src/bot-container/outbound-guards.test.ts. This reuses the same workspace to check
    // what that one cannot: does the customer-facing meter render getBillingState()'s held count and copy. The
    // held message is inserted directly (status = 'quota_hold'), not via /api/v1/message/send, which is not
    // mounted on this harness -- see scripts/operator-stack-harness.ts.
    const deviceKey = `WAPIT1${owner.tenant.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const deviceId = (await db.query(
      "INSERT INTO devices(tenant_id, device_key, label, status) VALUES ($1,$2,'Uji','online') RETURNING id",
      [owner.tenant, deviceKey],
    )).rows[0].id;
    await db.query(
      `INSERT INTO messages(tenant_id, device_id, device_key, to_number, content, type, status, priority, direction, quota_exempt)
       VALUES ($1,$2,$3,'6281234567890','pesan uji tertahan','text','quota_hold','normal','outbound',false)`,
      [owner.tenant, deviceId, deviceKey],
    );
    await page.reload();
    await expect(page.getByText("1 pesan tertahan menunggu kuota")).toBeVisible();
    await expect(page.getByText(/tidak ada yang dibuang/)).toBeVisible();
  });
});
