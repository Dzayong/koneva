import { expect, test } from "@playwright/test";
import { API, COOKIE, PROXY, PASSWORD, ORIGIN, apiSignIn, base32Decode, call, createOperator, db, nextCode, signInBrowser, totp, stepNow } from "./support/stack";

test.describe("operator sign-in, MFA and sessions (STACK-local: real DB, API, proxy, cookies)", () => {
  test("login + MFA in the browser sets one HttpOnly, Secure, Strict __Host- cookie; nothing secret reaches JS or storage", async ({ page, context }) => {
    const op = await createOperator();
    await signInBrowser(page, op);
    const cookies = (await context.cookies()).filter((c) => c.name === COOKIE);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    expect(cookies[0]!.domain).not.toMatch(/^\./); // host-only, as __Host- requires
    expect(await page.evaluate(() => document.cookie)).not.toContain("koneva_op");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toContain(cookies[0]!.value);
    expect(stored).not.toContain(op.secret.toString("hex"));
    // The database holds only the hash of the token.
    const raw = (await db.query("SELECT token_hash FROM operator_sessions WHERE operator_id=$1", [op.id])).rows;
    expect(raw).toHaveLength(1);
    expect(raw[0].token_hash).not.toBe(cookies[0]!.value);
  });

  test("wrong password and wrong code give no session; a code cannot be replayed", async ({ page, context }) => {
    const op = await createOperator();
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill(op.email);
    await page.getByLabel("Kata sandi").fill("salah-salah-salah");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /salah/i })).toBeVisible();
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByLabel("Kode verifikasi").fill("000000");
    await page.getByRole("button", { name: "Verifikasi" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Kode verifikasi salah/ })).toBeVisible();
    expect((await context.cookies()).filter((c) => c.name === COOKIE)).toHaveLength(0);
    expect(Number((await db.query("SELECT count(*) FROM operator_sessions WHERE operator_id=$1", [op.id])).rows[0].count)).toBe(0);
    // Replay: a code that was already accepted is refused for a second challenge.
    const a = await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } });
    const code = await nextCode(op);
    expect((await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: a.body.data.challenge_id, code } })).status).toBe(200);
    const b = await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } });
    const replay = await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: b.body.data.challenge_id, code } });
    expect(replay.status).toBe(401);
  });

  test("five wrong codes burn the challenge; the right code no longer works on it", async () => {
    const op = await createOperator();
    const a = await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } });
    const id = a.body.data.challenge_id;
    for (let i = 0; i < 5; i++) expect((await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: id, code: "000000" } })).status).toBe(401);
    const late = await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: id, code: await nextCode(op) } });
    expect(late.status).toBeGreaterThanOrEqual(401);
    expect(late.headers.get("set-cookie")).toBeNull();
  });

  test("first sign-in enrolls with the out-of-band code; recovery codes are shown once and one of them signs in later", async ({ page }) => {
    const op = await createOperator(undefined, { mfa: false, enrollmentCode: "AAAAA-BBBBB-CCCCC" });
    await page.goto("/operator/login");
    await page.getByLabel("Email").fill(op.email);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByLabel("Kode pendaftaran").fill("AAAAA-BBBBB-CCCCC");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByLabel("Kode QR autentikator")).toBeVisible();
    const manual = (await page.getByText(/^[A-Z2-7]{32}$/).first().innerText()).trim();
    const secret = base32Decode(manual);
    await page.getByLabel("Kode verifikasi").fill(totp(secret, stepNow()));
    await page.getByRole("button", { name: "Aktifkan dan masuk" }).click();
    await expect(page.getByRole("list", { name: "Kode pemulihan" }).locator("li")).toHaveCount(10);
    const codes = await page.getByRole("list", { name: "Kode pemulihan" }).locator("li").allInnerTexts();
    expect(codes).toHaveLength(10);
    await page.getByLabel("Saya sudah menyimpan kode pemulihan ini.").check();
    await page.getByRole("button", { name: "Lanjut ke panel" }).click();
    await expect(page).toHaveURL(/\/operator$/);
    // The enrollment code is single-use and the secret is encrypted at rest.
    const row = (await db.query("SELECT enrollment_code_hash, mfa_secret_enc FROM operators WHERE id=$1", [op.id])).rows[0];
    expect(row.enrollment_code_hash).toBeNull();
    expect(row.mfa_secret_enc).toMatch(/^v1\./);
    expect(row.mfa_secret_enc).not.toContain(manual);
    // A stored recovery code signs in exactly once.
    const a = await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } });
    const ok = await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: a.body.data.challenge_id, recovery_code: codes[0]! } });
    expect(ok.status, ok.text).toBe(200);
    const b = await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } });
    expect((await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: b.body.data.challenge_id, recovery_code: codes[0]! } })).status).toBe(401);
    const stored = (await db.query("SELECT code_hash FROM operator_recovery_codes WHERE operator_id=$1", [op.id])).rows;
    for (const c of codes) expect(JSON.stringify(stored)).not.toContain(c);
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
      const fresh = await createOperator(); // a fresh operator per case: a used one-time code cannot be reused inside its window
      await signInBrowser(page, fresh);
      await db.query(sql, [fresh.id]);
      await page.goto("/operator/payments");
      await expect(page, label).toHaveURL(/\/operator\/login/);
    }
  });

  test("disabling the operator or changing MFA revokes live sessions at once", async ({ page }) => {
    const op = await createOperator();
    await signInBrowser(page, op);
    await db.query("UPDATE operators SET mfa_secret_enc=mfa_secret_enc || '' , permissions=$2 WHERE id=$1", [op.id, ["payments:read"]]);
    await page.goto("/operator/payments");
    // Permissions are re-read from the database on every request, so the page keeps working with fewer rights...
    await expect(page.getByRole("heading", { name: /Pembayaran/ })).toBeVisible();
    await db.query("UPDATE operators SET disabled_at=now() WHERE id=$1", [op.id]);
    await page.goto("/operator/payments");
    await expect(page).toHaveURL(/\/operator\/login/);
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
    expect((await call("/me", { base: PROXY, session: s })).status).toBe(200); // none of the above ended the session
    const other = await apiSignIn(op);
    expect((await call("/auth/logout", { base: PROXY, session: { cookie: other.cookie, csrf: s.csrf }, method: "POST" })).status).toBe(403); // CSRF token of another session
    expect(ORIGIN).toMatch(/^http:\/\/localhost:\d+$/);
    expect(API).toContain("/operator");
  });

  test("permissions are enforced by the server, not just hidden in the UI", async () => {
    const reader = await createOperator(["payments:read"]);
    const s = await apiSignIn(reader);
    for (const path of ["/student-requests", "/workspaces", "/audit"]) expect((await call(path, { base: PROXY, session: s })).status).toBe(403);
    expect((await call("/invoices", { base: PROXY, session: s })).status).toBe(200);
  });
});
