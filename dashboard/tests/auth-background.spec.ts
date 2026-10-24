import { expect, test } from "@playwright/test";

/**
 * UI evidence only: the login/register mesh backgrounds render the right local asset, keep the ~40%
 * dark overlay, and the form stays visible/responsive. No backend, database or WhatsApp number touched.
 * Also guards that the legacy "Masuk dengan API key" path (removed 2026-10-02) never comes back.
 */
test.describe("login/signup background", () => {
  test("login page uses the local dark-purple mesh background with a dark overlay, and has no legacy API key login", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await page.goto("/login");

    const bg = page.getByTestId("auth-background");
    await expect(bg).toHaveAttribute("data-background", "login");
    await expect(bg).toHaveCSS("background-image", /auth-bg-login\.jpg/);
    await expect(page.getByTestId("auth-background-overlay")).toBeVisible();

    await expect(page.locator('[data-slot="card-title"]')).toHaveText("Masuk");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Kata sandi", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Ingat saya selama 14 hari/)).not.toBeChecked();

    await expect(page.getByText("Masuk dengan API key")).toHaveCount(0);
    await expect(page.locator('input[placeholder="wg_..."]')).toHaveCount(0);

    // The background image request itself must succeed (not a broken/hotlinked URL).
    const response = await page.request.get("/auth-bg-login.jpg");
    expect(response.ok()).toBe(true);
    expect(Number(response.headers()["content-length"] ?? "0")).toBeLessThan(300 * 1024);

    expect(consoleErrors).toEqual([]);
  });

  test("remember-me stores a persistent or browser-session login as selected", async ({ page }) => {
    await page.route("**/auth/login", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          token: "remember-me-test-token",
          expires_at: "2026-11-06T00:00:00.000Z",
          user: { id: "user-1", email: "test@example.com", name: "Test" },
          workspaces: [{ id: "workspace-1", name: "Test workspace" }],
        },
      }),
    }));
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Kata sandi", { exact: true }).fill("test-password");
    await page.getByLabel(/Ingat saya selama 14 hari/).setChecked(true);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForFunction(() => localStorage.getItem("wa_gateway_session") === "remember-me-test-token");
    expect(await page.evaluate(() => sessionStorage.getItem("wa_gateway_session"))).toBeNull();
  });

  test("without remember-me the session is kept only in browser session storage", async ({ page }) => {
    await page.route("**/auth/login", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          token: "remember-me-test-token",
          expires_at: "2026-11-06T00:00:00.000Z",
          user: { id: "user-1", email: "test@example.com", name: "Test" },
          workspaces: [{ id: "workspace-1", name: "Test workspace" }],
        },
      }),
    }));
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Kata sandi", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForFunction(() => sessionStorage.getItem("wa_gateway_session") === "remember-me-test-token");
    expect(await page.evaluate(() => localStorage.getItem("wa_gateway_session"))).toBeNull();
  });

  test("signup page uses the local dark red-purple mesh background with a dark overlay", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await page.goto("/signup");

    const bg = page.getByTestId("auth-background");
    await expect(bg).toHaveAttribute("data-background", "signup");
    await expect(bg).toHaveCSS("background-image", /auth-bg-signup\.jpg/);
    await expect(page.getByTestId("auth-background-overlay")).toBeVisible();

    const response = await page.request.get("/auth-bg-signup.jpg");
    expect(response.ok()).toBe(true);
    expect(Number(response.headers()["content-length"] ?? "0")).toBeLessThan(300 * 1024);

    expect(consoleErrors).toEqual([]);
  });

  test("login form stays usable at phone width, with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    await expect(page.locator('[data-slot="card-title"]')).toHaveText("Masuk");
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalScroll).toBe(false);
  });
});
