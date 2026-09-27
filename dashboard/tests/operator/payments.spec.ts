import { expect, test, type Page } from "@playwright/test";
import { freshState, installOperatorMock, type MockState } from "../support/operator-mock";

async function openInvoice(page: Page, state: MockState, id = "inv-1") {
  await installOperatorMock(page, state);
  await page.goto(`/operator/payments/${id}`);
  await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeVisible();
}
async function toReview(page: Page, reference = "TRF-0001") {
  await page.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Referensi (opsional)").fill(reference);
  await dialog.getByLabel(/Saya sudah memeriksa bukti/).check();
  await dialog.getByRole("button", { name: "Periksa ulang" }).click();
  await expect(dialog.getByText("Periksa ulang sebelum mengirim")).toBeVisible();
  return dialog;
}
const confirmPosts = (s: MockState) => s.requests.filter((r) => r.method === "POST" && r.path.endsWith("/confirm-payment"));

test.describe("payment queue (UI evidence, API faked)", () => {
  test("lists unpaid invoices by default, filters, paginates and searches through the URL", async ({ page }) => {
    const state = freshState();
    state.invoices = Array.from({ length: 30 }, (_, i) => ({ ...state.invoices[0]!, id: `inv-x${i}`, number: `INV-X-${String(i).padStart(3, "0")}`, workspace: { id: `w${i}`, name: `Toko ${i}` } }));
    state.invoices.push({ ...state.invoices[0]!, id: "inv-paid", number: "INV-PAID-1", status: "paid" });
    await installOperatorMock(page, state);
    await page.goto("/operator/payments");
    await expect(page.getByText("Menampilkan 1–25 dari 30")).toBeVisible();
    expect(state.requests.find((r) => r.path === "/invoices")!.query).toContain("status=unpaid");
    await page.getByRole("button", { name: "Berikutnya" }).click();
    await expect(page.getByText("Menampilkan 26–30 dari 30")).toBeVisible();
    await expect(page).toHaveURL(/offset=25/);
    await page.getByRole("button", { name: "Lunas" }).click();
    await expect(page).toHaveURL(/status=paid/);
    await expect(page.getByRole("link", { name: "INV-PAID-1" })).toBeVisible();
    await page.getByRole("button", { name: "Belum dibayar" }).click();
    const before = state.requests.filter((r) => r.path === "/invoices").length;
    await page.getByLabel("Cari invoice").fill("Toko 7");
    await expect(page).toHaveURL(/q=Toko\+7|q=Toko%207/);
    await expect.poll(() => state.requests.filter((r) => r.path === "/invoices").length - before).toBeLessThanOrEqual(2); // debounced, not one per keystroke
    await expect(page.getByRole("link", { name: "INV-X-007" })).toBeVisible();
  });

  test("shows empty and error states", async ({ page }) => {
    const state = freshState({ invoices: [] });
    await installOperatorMock(page, state);
    await page.goto("/operator/payments");
    await expect(page.getByText("Tidak ada invoice", { exact: true })).toBeVisible();
    state.listMode = "error";
    await page.getByRole("button", { name: "Lunas" }).click();
    await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });

  test("without payments:confirm there is no confirm button (server still decides)", async ({ page }) => {
    await installOperatorMock(page, freshState({ permissions: ["payments:read"] }));
    await page.goto("/operator/payments/inv-1");
    await expect(page.getByRole("heading", { name: "INV-202609-0001" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toHaveCount(0);
  });

  test("confirming: two steps, success only after the server answers, with CSRF, idempotency key and expected values", async ({ page }) => {
    const state = freshState({ confirmMode: "delay", delayMs: 800 });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toHaveCount(0); // not before the answer
    await expect(dialog.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeDisabled();
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
    expect(state.effects.confirm).toBe(1);
    const post = confirmPosts(state)[0]!;
    expect(post.headers["x-csrf-token"]).toBe("csrf_EXAMPLE");
    expect(post.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.body).toEqual({ method: "transfer", reference: "TRF-0001", expected: { amount_idr: 990000, version: 1 } });
    await dialog.getByRole("button", { name: "Selesai" }).click();
    await expect(page.getByText("Lunas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toHaveCount(0);
  });

  test("double clicking sends exactly one request", async ({ page }) => {
    const state = freshState({ confirmMode: "delay", delayMs: 700 });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    const button = dialog.getByRole("button", { name: "Konfirmasi pembayaran" });
    await button.dblclick();
    await button.click({ force: true }).catch(() => undefined);
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
    expect(confirmPosts(state)).toHaveLength(1);
    expect(state.effects.confirm).toBe(1);
  });

  test("already processed by another operator: shows who and when, then reloads fresh data", async ({ page }) => {
    const state = freshState({ confirmMode: "already_paid" });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Invoice ini sudah diproses");
    await expect(dialog.getByRole("alert")).toContainText("Operator Lain");
    const before = state.requests.filter((r) => r.method === "GET" && r.path === "/invoices/inv-1").length;
    await dialog.getByRole("button", { name: "Muat ulang data" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests.filter((r) => r.method === "GET" && r.path === "/invoices/inv-1").length).toBeGreaterThan(before);
  });

  test("ambiguous network result: locked form, retry reuses the SAME key, and the server applies it once", async ({ page }) => {
    const state = freshState({ confirmMode: "lose_response_once" });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
    expect(state.effects.confirm).toBe(1); // it DID happen on the server; the answer was lost
    await expect(dialog.getByRole("button", { name: "Konfirmasi pembayaran" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Coba lagi (aman diulang)" }).click();
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
    expect(state.effects.confirm).toBe(1); // replayed, not applied twice
    const keys = confirmPosts(state).map((r) => r.headers["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  test("after an ambiguous result the invoice status can be checked without creating a new key", async ({ page }) => {
    const state = freshState({ confirmMode: "html_502" });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
    await dialog.getByRole("button", { name: "Periksa status invoice" }).click();
    await expect(dialog.getByText("Status terbaru: belum lunas")).toBeVisible();
    expect(new Set(state.seenKeys).size).toBe(1);
  });

  test("a changed payload gets a new key (duplicate reference, then a corrected one)", async ({ page }) => {
    const state = freshState({ confirmMode: "duplicate_reference" });
    await openInvoice(page, state);
    const dialog = await toReview(page, "TRF-DUP");
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByRole("alert")).toContainText("sudah dipakai");
    await expect(dialog.getByRole("alert")).toContainText("INV-202609-0003");
    await dialog.getByRole("button", { name: "Kembali mengubah" }).click();
    await dialog.getByLabel("Referensi (opsional)").fill("TRF-BENAR");
    await dialog.getByRole("button", { name: "Periksa ulang" }).click();
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
    const keys = confirmPosts(state).map((r) => r.headers["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  test("a failed audit is reported as a failure, never as success, and nothing is retried automatically", async ({ page }) => {
    const state = freshState({ confirmMode: "audit_failed" });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Tidak ada yang berubah");
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toHaveCount(0);
    expect(confirmPosts(state)).toHaveLength(1);
  });

  test("a session that ends during confirmation is a definite failure that returns to sign-in", async ({ page }) => {
    const state = freshState({ confirmMode: "expired" });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(page).toHaveURL(/\/operator\/login\?reason=expired/);
    expect(state.effects.confirm).toBe(0);
  });

  test("the dialog cannot be dismissed by clicking outside while a request is in flight", async ({ page }) => {
    const state = freshState({ confirmMode: "delay", delayMs: 900 });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
  });

  test("keyboard: the dialog is reachable and closes with Escape when idle", async ({ page }) => {
    await openInvoice(page, freshState());
    await page.getByRole("button", { name: "Konfirmasi pembayaran" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
