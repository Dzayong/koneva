import { expect, test } from "@playwright/test";
import { COOKIE, PROXY, PASSWORD, apiSignIn, call, createOperator, db, signInBrowser } from "./support/stack";

test.describe("operator sign-in and sessions (STACK-local: real DB, API, proxy, cookies)", () => {
  test("login sets one HttpOnly, Secure, Strict __Host- cookie; nothing secret reaches JS or storage", async ({ page, context }) => {
    const op = await createOperator();
    await signInBrowser(page, op);
    const cookies = (await context.cookies()).filter((c) => c.name === COOKIE);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    expect(cookies[0]!.domain).not.toMatch(/^\./);
    expect(await page.evaluate(() => document.cookie)).not.toContain("koneva_op");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toContain(cookies[0]!.value);
    const raw = (await db.query("SELECT token_hash FROM operator_sessions WHERE operator_id=$1", [op.id])).rows;
    expect(raw).toHaveLength(1);
    expect(raw[0].token_hash).not.toBe(cookies[0]!.value);
  });

  test("wrong password gives an error and no session; correct password signs in directly", async ({ page, context }) => {
    const op = await createOperator();
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill(op.email);
    await page.getByLabel("Kata sandi").fill("salah-salah-salah");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /salah/i })).toBeVisible();
    expect((await context.cookies()).filter((c) => c.name === COOKIE)).toHaveLength(0);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page).toHaveURL(/\/operator$/);
    expect((await context.cookies()).filter((c) => c.name === COOKIE)).toHaveLength(1);
  });

  test("MFA endpoints return 410 Gone", async () => {
    const op = await createOperator();
    const s = await apiSignIn(op);
    for (const route of ["/auth/mfa/verify", "/auth/mfa/enroll/start", "/auth/mfa/enroll/confirm"]) {
      const r = await call(route, { session: s, method: "POST", body: {} });
      expect(r.status, `${route}: ${r.text}`).toBe(410);
      expect(r.body.error.code).toBe("MFA_REMOVED");
    }
  });

  test("logout, revocation, idle expiry and absolute expiry all end the session server-side", async ({ page, context }) => {
    const op = await createOperator();
    await signInBrowser(page, op);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/operator\/login/);
    expect((await page.request.get(`${PROXY}/me`)).status()).toBe(401);

    for (const [label, sql] of [
      ["revoked", "UPDATE operator_sessions SET revoked_at=now() WHERE operator_id=$1"],
      ["idle", "UPDATE operator_sessions SET idle_expires_at=now()-interval '1 minute' WHERE operator_id=$1 AND revoked_at IS NULL"],
      ["absolute", "UPDATE operator_sessions SET absolute_expires_at=now()-interval '1 minute' WHERE operator_id=$1 AND revoked_at IS NULL"],
    ] as const) {
      await context.clearCookies();
      const fresh = await createOperator();
      await signInBrowser(page, fresh);
      await db.query(sql, [fresh.id]);
      await page.goto("/operator/payments");
      await expect(page, label).toHaveURL(/\/operator\/login/);
    }
  });

  test("disabling the operator revokes live sessions at once", async ({ page }) => {
    const op = await createOperator();
    await signInBrowser(page, op);
    await db.query("UPDATE operators SET disabled_at=now() WHERE id=$1", [op.id]);
    await page.goto("/operator/payments");
    await expect(page).toHaveURL(/\/operator\/login/);
  });

  test("API login returns CSRF token that is required for mutations", async () => {
    const op = await createOperator();
    const s = await apiSignIn(op);
    expect(s.csrf).toBeTruthy();
    const ok = await call("/me", { base: PROXY, session: s });
    expect(ok.status).toBe(200);
    expect(ok.body.data.csrf_token).toBe(s.csrf);
    const bad = await call("/auth/logout", { base: PROXY, session: { ...s, csrf: "wrong" }, method: "POST" });
    expect(bad.status).toBe(403);
  });
});

test.describe("tenant and admin credentials never open the operator surface (through the proxy)", () => {
  test("ADMIN_API_KEY, tenant bearer tokens and tenant session cookies are rejected", async ({ request }) => {
    for (const headers of <Array<Record<string, string>>>[
      { "x-admin-key": "stack-test-admin" }, { Authorization: "Bearer stack-test-admin" }, { Authorization: "Bearer wgs_synthetic" },
      { Cookie: "wa_gateway_session=synthetic; koneva_session=synthetic" }, { Cookie: `${COOKIE}=${"a".repeat(64)}` },
    ]) {
      const r = await request.get(`${PROXY}/me`, { headers });
      expect(r.status(), JSON.stringify(headers)).toBe(401);
      expect(r.headers()["cache-control"]).toBe("no-store");
      expect(r.headers()["access-control-allow-origin"]).toBeUndefined();
    }
    for (const path of ["/invoices", "/student-requests", "/workspaces", "/audit"]) expect((await request.get(`${PROXY}${path}`, { headers: { "x-admin-key": "stack-test-admin" } })).status()).toBe(401);
  });

  test("Origin, cross-site fetches and the custom header are enforced through the proxy; CSRF is per session", async () => {
    const op = await createOperator();
    const s = await apiSignIn(op);
    const cross = await call("/auth/logout", { base: PROXY, session: s, method: "POST", headers: { Origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    const site = await call("/auth/logout", { base: PROXY, session: s, method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(site.status).toBe(403);
    const noCsrf = await call("/auth/logout", { base: PROXY, session: { ...s, csrf: "bad" }, method: "POST" });
    expect(noCsrf.status).toBe(403);
    expect((await call("/me", { base: PROXY, session: s })).status).toBe(200);
    const other = await apiSignIn(op);
    expect((await call("/auth/logout", { base: PROXY, session: { cookie: other.cookie, csrf: s.csrf }, method: "POST" })).status).toBe(403);
  });

  test("permissions are enforced by the server, not just hidden in the UI", async () => {
    const reader = await createOperator(["payments:read"]);
    const s = await apiSignIn(reader);
    for (const path of ["/student-requests", "/workspaces", "/audit"]) expect((await call(path, { base: PROXY, session: s })).status).toBe(403);
    expect((await call("/invoices", { base: PROXY, session: s })).status).toBe(200);
  });
});
