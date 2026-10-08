import { expect, test, type Page } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";
import { signIn } from "../support/sign-in";

const storageKeys = (page: Page) => page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
const SENSITIVE = /operator|csrf|token|session|password|cookie/i;

test.describe("operator sign-in and session handling (UI evidence, API faked)", () => {
  test("visiting a panel page without a session goes to sign-in and remembers where to return", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false }));
    await page.goto("/operator/payments");
    await expect(page).toHaveURL(/\/operator\/login\?reason=required&next=%2Foperator%2Fpayments/);
    await expect(page.getByText("Silakan masuk untuk membuka panel.")).toBeVisible();
  });

  test("wrong credentials show a message and stay on the page", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false, loginMode: "bad_password" }));
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("ops@example.test");
    await page.getByLabel("Kata sandi").fill("salah");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Email atau kata sandi salah" })).toBeVisible();
    await expect(page).toHaveURL(/\/operator\/login/);
  });

  test("successful sign-in returns to the requested page and stores nothing sensitive in the browser", async ({ page }) => {
    const state = freshState({ authenticated: false });
    await installOperatorMock(page, state);
    await page.goto("/operator/login?next=%2Foperator%2Fpayments");
    await signIn(page);
    await expect(page).toHaveURL(/\/operator\/payments$/);
    await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
    expect((await storageKeys(page)).filter((k) => SENSITIVE.test(k))).toEqual([]);
    expect(state.requests.every((r) => r.headers["x-requested-with"] === "koneva-operator")).toBe(true);
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("an unsafe return address is ignored", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false }));
    await page.goto("/operator/login?next=https%3A%2F%2Fevil.example%2F");
    await signIn(page);
    await expect(page).toHaveURL(/\/operator$/);
  });

  test("rate limiting tells the operator how long to wait", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false, loginMode: "rate_limited" }));
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("a@example.test");
    await page.getByLabel("Kata sandi").fill("x");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "42 detik" })).toBeVisible();
  });

  test("when the operator API does not exist the login page says so", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false, loginMode: "absent" }));
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill("a@example.test");
    await page.getByLabel("Kata sandi").fill("x");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "belum tersedia" })).toBeVisible();
  });

  test("a signed-in person who is not an operator sees access denied, not the panel", async ({ page }) => {
    await installOperatorMock(page, freshState({ loginMode: "not_operator" }));
    await page.goto("/operator");
    await expect(page.getByText("Akses ditolak")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Panel operator" })).toHaveCount(0);
  });

  test("a session that expires while working sends the operator to sign-in with the reason", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/payments");
    await expect(page.getByRole("link", { name: "INV-202609-0001" })).toBeVisible();
    state.listMode = "expired";
    await page.getByRole("button", { name: "Lunas" }).click();
    await expect(page).toHaveURL(/\/operator\/login\?reason=expired/);
    await expect(page.getByText("Sesi Anda berakhir")).toBeVisible();
  });

  test("operator sign-out and session loss never touch the tenant session", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.addInitScript(() => { localStorage.setItem("wa_gateway_session", "wgs_TENANT_TEST"); localStorage.setItem("wa_gateway_workspace", "ws-1"); });
    await page.goto("/operator");
    await expect(page.getByRole("heading", { name: "Ringkasan antrean" })).toBeVisible();
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/operator\/login\?reason=logged_out/);
    expect(await page.evaluate(() => [localStorage.getItem("wa_gateway_session"), localStorage.getItem("wa_gateway_workspace")])).toEqual(["wgs_TENANT_TEST", "ws-1"]);
    expect(state.requests.some((r) => r.path === "/auth/logout")).toBe(true);
  });

  test("menu entries follow permissions, but the page itself also refuses without them", async ({ page }) => {
    await installOperatorMock(page, freshState({ permissions: ["students:read"] }));
    await page.goto("/operator/payments");
    await expect(page.getByRole("link", { name: "Pembayaran" })).toHaveCount(0);
    await expect(page.getByText("Akses ditolak")).toBeVisible();
  });
});
