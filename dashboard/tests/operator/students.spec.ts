import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock, type MockState } from "../support/operator-mock";

const decisionPosts = (s: MockState) => s.requests.filter((r) => r.method === "POST" && r.path.endsWith("/decision"));

test.describe("student verification (UI evidence, API faked)", () => {
  test("list defaults to pending, shows only masked emails, and filters", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/students");
    await expect(page.getByRole("link", { name: "Uji Pelajar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kelas Contoh" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "m***1@kampus.example.ac.id" })).toBeVisible();
    await expect(page.getByText("mahasiswa1@kampus.example.ac.id")).toHaveCount(0); // full address is detail-only
    await page.getByRole("button", { name: "Disetujui" }).click();
    await expect(page.getByRole("link", { name: "Kelas Contoh" })).toBeVisible();
  });

  test("detail states that the email domain is not proof, and offers no revoke", async ({ page }) => {
    await installOperatorMock(page, freshState());
    await page.goto("/operator/students/req-1");
    await expect(page.getByRole("note")).toContainText("bukan bukti status pelajar");
    await expect(page.getByText("mahasiswa1@kampus.example.ac.id")).toBeVisible();
    await expect(page.getByText("Mahasiswa semester 5")).toBeVisible();
    await expect(page.getByRole("button", { name: /cabut|revoke/i })).toHaveCount(0);
    await page.goto("/operator/students/req-2"); // already approved
    await expect(page.getByRole("button", { name: "Putuskan" })).toHaveCount(0);
  });

  test("rejecting needs a reason; approving does not; success appears only after the server answers", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/students/req-1");
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Tolak").check();
    await expect(dialog.getByRole("button", { name: "Tolak" }).last()).toBeDisabled();
    await dialog.getByLabel(/Alasan/).fill("Email bukan email kampus");
    await dialog.getByRole("button", { name: "Tolak" }).last().click();
    await expect(dialog.getByText(/Keputusan tercatat: Ditolak/)).toBeVisible();
    const post = decisionPosts(state)[0]!;
    expect(post.body).toEqual({ decision: "reject", reason: "Email bukan email kampus", expected: { request_id: "req-1", version: 1 } });
    expect(post.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.headers["x-csrf-token"]).toBe("csrf_EXAMPLE");
    await dialog.getByRole("button", { name: "Selesai" }).click();
    await expect(page.getByText("Ditolak").first()).toBeVisible();
  });

  test("approve works without a reason", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/students/req-1");
    await page.getByRole("button", { name: "Putuskan" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Setujui" }).click();
    await expect(page.getByRole("dialog").getByText(/Keputusan tercatat: Disetujui/)).toBeVisible();
    expect(state.effects.decide).toBe(1);
  });

  test("decided by another operator meanwhile: shows who, then reloads", async ({ page }) => {
    const state = freshState({ decideMode: "not_pending" });
    await installOperatorMock(page, state);
    await page.goto("/operator/students/req-1");
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Setujui" }).click();
    await expect(dialog.getByRole("alert")).toContainText("sudah diputuskan");
    await expect(dialog.getByRole("alert")).toContainText("Operator Lain");
    await dialog.getByRole("button", { name: "Muat ulang data" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("lost answer: retry reuses the key and the decision is recorded once", async ({ page }) => {
    const state = freshState({ decideMode: "lose_response_once" });
    await installOperatorMock(page, state);
    await page.goto("/operator/students/req-1");
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Setujui" }).click();
    await expect(dialog.getByText("Hasil belum pasti")).toBeVisible();
    await dialog.getByRole("button", { name: "Coba lagi (aman diulang)" }).click();
    await expect(dialog.getByText(/Keputusan tercatat/)).toBeVisible();
    expect(state.effects.decide).toBe(1);
    const keys = decisionPosts(state).map((r) => r.headers["idempotency-key"]);
    expect(keys[1]).toBe(keys[0]);
  });

  test("read-only students permission cannot decide", async ({ page }) => {
    await installOperatorMock(page, freshState({ permissions: ["students:read"] }));
    await page.goto("/operator/students/req-1");
    await expect(page.getByRole("heading", { name: "Uji Pelajar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Putuskan" })).toHaveCount(0);
  });
});
