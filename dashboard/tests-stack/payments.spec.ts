import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, PROXY, apiSignIn, auditCount, call, createOperator, db, fault, faultsApplied, invoice, invoiceRow, nextCode, signInBrowser, type Op } from "./support/stack";
import { randomUUID } from "node:crypto";

const payBody = (extra = {}) => ({ method: "transfer", expected: { amount_idr: 99000, version: 1 }, ...extra });

async function openReview(page: Page, id: string, reference = `TRF-${randomUUID().slice(0, 8)}`) {
  await page.goto(`/operator/payments/${id}`);
  await page.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Referensi (opsional)").fill(reference);
  await dialog.getByLabel(/Saya sudah memeriksa bukti/).check();
  await dialog.getByRole("button", { name: "Periksa ulang" }).click();
  await expect(dialog.getByText("Periksa ulang sebelum mengirim")).toBeVisible();
  return dialog;
}
const paid = (page: Page) => page.getByRole("dialog").getByText("Pembayaran dikonfirmasi");

test.describe("manual payment confirmation (STACK-local)", () => {
  let op: Op;
  test.beforeEach(async ({ page }) => { await fault("none"); op = await createOperator(); await signInBrowser(page, op); });

  test("normal payment: invoice becomes paid once, with exactly one audit row naming this operator", async ({ page }) => {
    const inv = await invoice();
    const dialog = await openReview(page, inv.id);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(paid(page)).toBeVisible();
    expect(await invoiceRow(inv.id)).toMatchObject({ status: "paid", version: 2 });
    expect(await auditCount(inv.id)).toBe(1);
    const audit = (await db.query("SELECT operator_id, action, changes FROM operator_audit WHERE target_id=$1", [inv.id])).rows[0];
    expect(audit.operator_id).toBe(op.id);
    expect(JSON.stringify(audit.changes)).not.toContain("secret");
    expect((await db.query("SELECT count(*) FROM operator_idempotency WHERE target_id=$1", [inv.id])).rows[0].count).toBe("1");
  });

  test("lost success response (connection dropped after COMMIT): UI says unknown; retry replays the stored answer; still one payment", async ({ page }) => {
    const inv = await invoice();
    const dialog = await openReview(page, inv.id);
    await fault("drop");
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
    expect(await faultsApplied()).toBeGreaterThan(0);
    expect((await invoiceRow(inv.id)).status).toBe("paid"); // the effect really happened, the browser just could not know
    const before = await auditCount(inv.id);
    await dialog.getByRole("button", { name: "Coba lagi (aman diulang)" }).click();
    await expect(paid(page)).toBeVisible();
    expect(await auditCount(inv.id)).toBe(before);
    expect(before).toBe(1);
    expect((await db.query("SELECT count(*) FROM operator_idempotency WHERE target_id=$1", [inv.id])).rows[0].count).toBe("1");
  });

  for (const mode of ["html502", "redirect"] as const) {
    test(`${mode} after COMMIT is unknown, "Periksa status invoice" reports the truth, no second effect`, async ({ page }) => {
      const inv = await invoice();
      const dialog = await openReview(page, inv.id);
      await fault(mode);
      await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
      await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
      await dialog.getByRole("button", { name: "Periksa status invoice" }).click();
      await expect(dialog.getByText(/Status terbaru: Lunas/)).toBeVisible();
      expect(await auditCount(inv.id)).toBe(1);
    });
  }

  test("audit failure rolls back the whole transaction and the UI reports a definite failure (nothing changed)", async ({ page }) => {
    const inv = await invoice();
    const dialog = await openReview(page, inv.id);
    await db.query(`CREATE OR REPLACE FUNCTION stack_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await db.query("CREATE TRIGGER stack_reject_audit BEFORE INSERT ON operator_audit FOR EACH ROW EXECUTE FUNCTION stack_reject_audit()");
    try {
      await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Tidak ada yang berubah");
    } finally { await db.query("DROP TRIGGER stack_reject_audit ON operator_audit"); }
    expect(await invoiceRow(inv.id)).toMatchObject({ status: "unpaid", paid_at: null, version: 1 });
    expect(await auditCount(inv.id)).toBe(0);
    expect((await db.query("SELECT count(*) FROM operator_idempotency WHERE target_id=$1", [inv.id])).rows[0].count).toBe("0");
    expect((await db.query("SELECT count(*) FROM subscriptions WHERE tenant_id=$1", [inv.tenant])).rows[0].count).toBe("0");
  });

  test("REAUTH_REQUIRED (login older than 15 minutes) changes nothing; after password + code the SAME payload is applied once", async ({ page }) => {
    const inv = await invoice();
    const dialog = await openReview(page, inv.id);
    await db.query("UPDATE operator_sessions SET authenticated_at=now()-interval '16 minutes' WHERE operator_id=$1", [op.id]);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Masuk ulang diperlukan")).toBeVisible();
    expect(await invoiceRow(inv.id)).toMatchObject({ status: "unpaid" });
    expect(await auditCount(inv.id)).toBe(0);
    await dialog.getByLabel("Kata sandi").fill(PASSWORD);
    await dialog.getByRole("button", { name: "Lanjut" }).click();
    await dialog.getByLabel("Kode verifikasi").fill(await nextCode(op));
    await dialog.getByRole("button", { name: "Verifikasi" }).click();
    await expect(paid(page)).toBeVisible();
    expect(await auditCount(inv.id)).toBe(1);
  });

  test("a session revoked mid-way is a definite failure that returns to sign-in, with no effect", async ({ page }) => {
    const inv = await invoice();
    const dialog = await openReview(page, inv.id);
    await db.query("UPDATE operator_sessions SET revoked_at=now() WHERE operator_id=$1", [op.id]);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(page).toHaveURL(/\/operator\/login/);
    expect((await invoiceRow(inv.id)).status).toBe("unpaid");
    expect(await auditCount(inv.id)).toBe(0);
  });

  test("after a reload the current status is read again before any action is offered", async ({ page }) => {
    const inv = await invoice();
    await page.goto(`/operator/payments/${inv.id}`);
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeEnabled();
    const other = await apiSignIn(await createOperator());
    expect((await call(`/invoices/${inv.id}/confirm-payment`, { session: other, method: "POST", body: payBody(), key: randomUUID() })).status).toBe(200);
    await page.reload();
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toHaveCount(0);
    await expect(page.getByText("Lunas").first()).toBeVisible();
  });
});

test.describe("payment API semantics through the real proxy (STACK-local)", () => {
  test("replay returns the stored answer flagged as replay; same key with another payload is refused; payload changes never apply", async () => {
    const a = await apiSignIn(await createOperator());
    const inv = await invoice(), key = randomUUID();
    const first = await call(`/invoices/${inv.id}/confirm-payment`, { base: PROXY, session: a, method: "POST", body: payBody({ reference: "R-1" }), key });
    expect(first.status, first.text).toBe(200);
    const again = await call(`/invoices/${inv.id}/confirm-payment`, { base: PROXY, session: a, method: "POST", body: payBody({ reference: "R-1" }), key });
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replay")).toBe("true");
    expect(again.body).toEqual(first.body);
    const changed = await call(`/invoices/${inv.id}/confirm-payment`, { base: PROXY, session: a, method: "POST", body: payBody({ reference: "R-2" }), key });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await auditCount(inv.id)).toBe(1);
    const paidRow = (await db.query("SELECT reference FROM invoices WHERE id=$1", [inv.id])).rows[0];
    expect(paidRow.reference).toBe("R-1");
  });

  test("two operators confirm the same invoice at the same time: exactly one wins, the other is told who/what, one audit row", async () => {
    const [a, b] = await Promise.all([createOperator().then(apiSignIn), createOperator().then(apiSignIn)]);
    for (let round = 0; round < 3; round++) {
      const inv = await invoice();
      const results = await Promise.all([a, b].map((s) => call(`/invoices/${inv.id}/confirm-payment`, { base: PROXY, session: s, method: "POST", body: payBody(), key: randomUUID() })));
      const codes = results.map((r) => r.status).sort();
      expect(codes, JSON.stringify(results.map((r) => r.text))).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe("INVOICE_NOT_PAYABLE");
      expect(await auditCount(inv.id)).toBe(1);
    }
  });

  test("the same paid reference cannot settle two invoices (case/space-insensitive)", async () => {
    const a = await apiSignIn(await createOperator());
    const one = await invoice(), two = await invoice();
    expect((await call(`/invoices/${one.id}/confirm-payment`, { base: PROXY, session: a, method: "POST", body: payBody({ reference: "TRF-DUP-1" }), key: randomUUID() })).status).toBe(200);
    const dup = await call(`/invoices/${two.id}/confirm-payment`, { base: PROXY, session: a, method: "POST", body: payBody({ reference: "  trf-dup-1 " }), key: randomUUID() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_REFERENCE");
    expect((await invoiceRow(two.id)).status).toBe("unpaid");
  });

  test("stale expectations (changed amount/version) are refused without effect", async () => {
    const a = await apiSignIn(await createOperator());
    const inv = await invoice();
    const stale = await call(`/invoices/${inv.id}/confirm-payment`, { base: PROXY, session: a, method: "POST", body: { method: "transfer", expected: { amount_idr: 1, version: 1 } }, key: randomUUID() });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("INVOICE_CHANGED");
    expect((await invoiceRow(inv.id)).status).toBe("unpaid");
  });
});
