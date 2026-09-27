import { expect, test } from "@playwright/test";
import { freshState, type ConfirmMode } from "../support/operator-mock";
import { confirmPosts, openInvoice, toReview } from "../support/payment-flow";
import { signIn } from "../support/sign-in";

test.describe("mutations whose outcome cannot be known (UI evidence, faults injected in the fake API)", () => {
  // Every case: the dialog says "not certain", the form is locked, and retrying reuses the SAME key with the SAME payload.
  const ambiguous: Array<[string, ConfirmMode]> = [
    ["a proxy error page (502)", "html_502"],
    ["a 404 that is not the API's own answer", "html_404"],
    ["a 200 that is not the API's own answer", "bad_body_200"],
    ["a redirect", "redirect"],
    ["OUTCOME_UNKNOWN", "outcome_unknown"],
    ["AUDIT_FAILED without a rollback marker", "audit_unknown"],
  ];
  for (const [label, mode] of ambiguous) {
    test(`${label} is unknown, never "failed", and retry keeps key and payload`, async ({ page }) => {
      const state = freshState({ confirmMode: mode });
      await openInvoice(page, state);
      const dialog = await toReview(page);
      await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
      await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Konfirmasi pembayaran" })).toHaveCount(0);
      await expect(dialog.getByLabel("Referensi (opsional)")).toHaveCount(0); // payload is frozen: no field can change it
      state.confirmMode = "ok";
      await dialog.getByRole("button", { name: "Coba lagi (aman diulang)" }).click();
      await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
      const posts = confirmPosts(state);
      expect(posts).toHaveLength(2);
      expect(posts[1]!.headers["idempotency-key"]).toBe(posts[0]!.headers["idempotency-key"]);
      expect(posts[1]!.body).toEqual(posts[0]!.body);
      expect(state.effects.confirm).toBe(1);
    });
  }

  test("a request that never answers times out as unknown (not proof of failure) and can be retried safely", async ({ page }) => {
    const state = freshState({ confirmMode: "hang" });
    await page.clock.install();
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeDisabled();
    await page.clock.fastForward(31_000);
    await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
    state.confirmMode = "ok";
    await dialog.getByRole("button", { name: "Coba lagi (aman diulang)" }).click();
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
    const keys = confirmPosts(state).map((r) => r.headers["idempotency-key"]);
    expect(new Set(keys).size).toBe(1);
  });

  test("a slow read shows an error with retry after its deadline", async ({ page }) => {
    const state = freshState();
    await page.clock.install();
    await import("../support/operator-mock").then((m) => m.installOperatorMock(page, state));
    await page.goto("/operator/payments");
    await expect(page.getByRole("link", { name: "INV-202609-0001" })).toBeVisible();
    state.listMode = "hang";
    const before = state.requests.filter((r) => r.path === "/invoices").length;
    await page.getByRole("button", { name: "Lunas" }).click();
    await expect.poll(() => state.requests.filter((r) => r.path === "/invoices").length).toBeGreaterThan(before);
    await page.clock.fastForward(16_000);
    await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });

  test("after a lost answer and a page reload the operator sees the real invoice state, not a stale dialog", async ({ page }) => {
    const state = freshState({ confirmMode: "lose_response_once", detailDelayMs: 600 });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
    state.detailDelayMs = 900;
    await page.reload();
    await expect(page.getByText("Memuat…")).toBeVisible(); // nothing to act on until the status is re-read
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Lunas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toHaveCount(0);
    expect(state.effects.confirm).toBe(1);
  });

  test("the action button stays disabled while cached status is being re-read", async ({ page }) => {
    const state = freshState();
    await import("../support/operator-mock").then((m) => m.installOperatorMock(page, state));
    await page.goto("/operator/payments/inv-1");
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeEnabled();
    await page.getByRole("link", { name: "Kembali ke pembayaran" }).click();
    await expect(page.getByRole("link", { name: "INV-202609-0001" })).toBeVisible();
    state.detailDelayMs = 900; // the copy in the cache is old; the status is re-read before anything can be confirmed
    await page.getByRole("link", { name: "INV-202609-0001" }).click();
    await expect(page.getByRole("heading", { name: "INV-202609-0001" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeDisabled();
    await expect(page.getByText("Memeriksa status terbaru…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeEnabled();
  });

  test("REAUTH_REQUIRED means nothing happened: sign in again in place, then the SAME payload continues with the SAME key", async ({ page }) => {
    const state = freshState({ confirmMode: "reauth_required", recentAuth: false });
    await openInvoice(page, state);
    const dialog = await toReview(page);
    await dialog.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(dialog.getByText("Masuk ulang diperlukan")).toBeVisible();
    await expect(dialog.getByText("Belum ada yang diubah")).toBeVisible();
    expect(state.effects.confirm).toBe(0);
    await expect(dialog.getByLabel("Email")).toHaveValue("ops@example.test");
    await expect(dialog.getByLabel("Email")).toHaveJSProperty("readOnly", true);
    await signInWithin(dialog);
    await expect(dialog.getByText("Pembayaran dikonfirmasi")).toBeVisible();
    const posts = confirmPosts(state);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.headers["idempotency-key"]).toBe(posts[0]!.headers["idempotency-key"]);
    expect(state.effects.confirm).toBe(1);
    expect(state.mfaVerified).toBe(1);
  });

  test("student decisions also ask for a fresh sign-in before any effect", async ({ page }) => {
    const state = freshState({ decideMode: "reauth_required", recentAuth: false });
    await import("../support/operator-mock").then((m) => m.installOperatorMock(page, state));
    await page.goto("/operator/students/req-1");
    await expect(page.getByRole("button", { name: "Putuskan" })).toBeEnabled();
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Setujui" }).click();
    await expect(dialog.getByText("Masuk ulang diperlukan")).toBeVisible();
    expect(state.effects.decide).toBe(0);
    await signInWithin(dialog);
    await expect(dialog.getByText(/Keputusan tercatat: Disetujui/)).toBeVisible();
    expect(state.effects.decide).toBe(1);
    const decisions = state.requests.filter((r) => r.path.endsWith("/decision"));
    expect(decisions).toHaveLength(2);
    expect(decisions[1]!.headers["idempotency-key"]).toBe(decisions[0]!.headers["idempotency-key"]);
  });
});

async function signInWithin(dialog: import("@playwright/test").Locator) {
  await dialog.getByLabel("Kata sandi").fill("rahasia-uji");
  await dialog.getByRole("button", { name: "Lanjut" }).click();
  await dialog.getByLabel("Kode verifikasi").fill("123456");
  await dialog.getByRole("button", { name: "Verifikasi" }).click();
}
void signIn;
