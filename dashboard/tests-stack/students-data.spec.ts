import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PROXY, PASSWORD, apiSignIn, call, createOperator, db, invoice, resetLimits, signInBrowser, studentRequest, workspace, type Op } from "./support/stack";

const NOTE = "Catatan pribadi mahasiswa NIM 998877";

test.describe("student verification (STACK-local)", () => {
  let op: Op;
  test.beforeEach(async ({ page }) => { op = await createOperator(); await signInBrowser(page, op); });

  test("approve in the browser: request approved once, workspace verified, audit row, private note never in a list or in logs", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text())); page.on("pageerror", (e) => logs.push(String(e)));
    const s = await studentRequest(NOTE);
    await page.goto("/operator/students");
    await expect(page.getByRole("cell", { name: "m***@kampus.example.ac.id" })).toBeVisible();
    expect(await page.content()).not.toContain("NIM 998877"); // the list carries no private note
    await page.goto(`/operator/students/${s.id}`);
    await expect(page.getByText(NOTE)).toBeVisible();
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Setujui" }).click();
    await expect(dialog.getByText(/Keputusan tercatat: Disetujui/)).toBeVisible();
    expect((await db.query("SELECT status, decided_by FROM student_requests WHERE id=$1", [s.id])).rows[0]).toMatchObject({ status: "approved", decided_by: op.id });
    expect((await db.query("SELECT student_verified_at FROM tenants WHERE id=$1", [s.tenant])).rows[0].student_verified_at).not.toBeNull();
    expect((await db.query("SELECT count(*) FROM operator_audit WHERE target_id=$1", [s.id])).rows[0].count).toBe("1");
    for (const line of logs) expect(line).not.toContain("998877");
    const audit = JSON.stringify((await db.query("SELECT changes, reason, target_label FROM operator_audit WHERE target_id=$1", [s.id])).rows);
    expect(audit).not.toContain("998877");
  });

  test("an invalid decision needs a reason (server enforces it too) and opens the seven-day correction window", async ({ page }) => {
    const s = await studentRequest();
    const api = await apiSignIn(op);
    const noReason = await call(`/student-requests/${s.id}/decision`, { base: PROXY, session: api, method: "POST", key: randomUUID(), body: { decision: "reject", expected: { request_id: s.id, version: 1 } } });
    expect(noReason.status).toBe(400);
    await page.goto(`/operator/students/${s.id}`);
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Tolak").check();
    await dialog.getByLabel(/Alasan/).fill("Email bukan email kampus");
    await dialog.getByRole("button", { name: "Tolak" }).last().click();
    await expect(dialog.getByText(/Keputusan tercatat: Perlu perbaikan/)).toBeVisible();
    const decision = (await db.query("SELECT status,correction_due_at FROM student_requests WHERE id=$1", [s.id])).rows[0];
    expect(decision.status).toBe("correction_required");
    expect(new Date(decision.correction_due_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await db.query("SELECT student_verified_at,student_invalid_decisions FROM tenants WHERE id=$1", [s.tenant])).rows[0]).toMatchObject({ student_verified_at: null, student_invalid_decisions: 1 });
  });

  test("resubmission supersedes the old request, history is kept, and the old request can no longer be decided", async ({ page }) => {
    const tenant = await workspace("Pelajar");
    const oldId = randomUUID(), newId = randomUUID();
    await db.query("INSERT INTO student_requests(id,tenant_id,requester_email,note,status) VALUES ($1,$2,'mahasiswa@kampus.example.ac.id','catatan lama','superseded')", [oldId, tenant]);
    await db.query("INSERT INTO student_requests(id,tenant_id,requester_email,note) VALUES ($1,$2,'mahasiswa@kampus.example.ac.id','catatan baru')", [newId, tenant]);
    const api = await apiSignIn(op);
    const stale = await call(`/student-requests/${oldId}/decision`, { base: PROXY, session: api, method: "POST", key: randomUUID(), body: { decision: "approve", expected: { request_id: oldId, version: 1 } } });
    expect(stale.status).toBe(409);
    expect(["REQUEST_SUPERSEDED", "REQUEST_NOT_PENDING"]).toContain(stale.body.error.code);
    const detail = await call(`/student-requests/${newId}`, { base: PROXY, session: api });
    expect(detail.body.data.history.some((h: { status: string }) => h.status === "superseded")).toBe(true);
    await page.goto(`/operator/students/${newId}`);
    await expect(page.getByText("catatan baru")).toBeVisible();
    // Two operators deciding the same pending request: one wins.
    const b = await apiSignIn(await createOperator());
    const results = await Promise.all([api, b].map((session) => call(`/student-requests/${newId}/decision`, { base: PROXY, session, method: "POST", key: randomUUID(), body: { decision: "approve", expected: { request_id: newId, version: 1 } } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.query("SELECT count(*) FROM operator_audit WHERE target_id=$1", [newId])).rows[0].count).toBe("1");
  });
});

test.describe("dates, pagination and data exposure (STACK-local)", () => {
  test("WIB day → UTC range: start inclusive, next-day start exclusive, in the UI and in the query the browser sent", async ({ page }) => {
    const op = await createOperator();
    await signInBrowser(page, op);
    const target = randomUUID();
    const rows: Array<[string, string]> = [
      ["2026-09-25T16:59:59.999Z", "B0 WIB 25 Sep 23:59:59.999 (before)"],
      ["2026-09-25T17:00:00.000Z", "B1 WIB 26 Sep 00:00:00 (first instant)"],
      ["2026-09-26T16:59:59.999Z", "B2 WIB 26 Sep 23:59:59.999 (last instant)"],
      ["2026-09-26T17:00:00.000Z", "B3 WIB 27 Sep 00:00:00 (after)"],
    ];
    for (const [at, label] of rows) await db.query("INSERT INTO operator_audit(at,operator_id,action,target_type,target_id,target_label,changes,request_id) VALUES ($1,$2,'stack.boundary','invoice',$3,$4,'{}'::jsonb,$5)", [at, op.id, target, label, randomUUID()]);
    const sent: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/operator/audit")) sent.push(decodeURIComponent(r.url())); });
    await page.goto("/operator/audit");
    await page.getByLabel("Filter aksi").fill("stack.boundary");
    await page.getByLabel("Dari (tanggal WIB)").fill("2026-09-26");
    await page.getByLabel("Sampai (tanggal WIB, termasuk)").fill("2026-09-26");
    await expect.poll(() => sent.some((u) => u.includes("from=2026-09-25T17:00:00.000Z") && u.includes("to=2026-09-26T17:00:00.000Z") && u.includes("action=stack.boundary"))).toBe(true);
    await expect(page.getByText("Menampilkan 1–2 dari 2")).toBeVisible();
    const api = await apiSignIn(op);
    const res = await call(`/audit?action=stack.boundary&from=${encodeURIComponent("2026-09-25T17:00:00.000Z")}&to=${encodeURIComponent("2026-09-26T17:00:00.000Z")}`, { base: PROXY, session: api });
    expect(res.body.data.map((a: { target: { label: string } }) => a.target.label.slice(0, 2)).sort()).toEqual(["B1", "B2"]);
  });

  test("pagination is stable and complete; page size is capped; no secret column appears anywhere", async () => {
    const op = await createOperator();
    const api = await apiSignIn(op);
    const tag = randomUUID().slice(0, 8);
    for (let i = 0; i < 30; i++) {
      const id = randomUUID();
      await db.query("INSERT INTO tenants(id,name,email,api_key,webhook_secret) VALUES ($1,$2,$3,$4,$5)", [id, `Pagi ${tag} ${String(i).padStart(2, "0")}`, `${id}@example.test`, `secret-key-${id}`, `secret-hook-${id}`]);
    }
    const first = await call(`/workspaces?q=${tag}&limit=25&offset=0`, { base: PROXY, session: api });
    const second = await call(`/workspaces?q=${tag}&limit=25&offset=25`, { base: PROXY, session: api });
    expect(first.body.data).toHaveLength(25);
    expect(second.body.data).toHaveLength(5);
    expect(first.body.total ?? first.body.pagination?.total).toBe(30);
    const ids = [...first.body.data, ...second.body.data].map((w: { id: string }) => w.id);
    expect(new Set(ids).size).toBe(30);
    expect((await call("/workspaces?limit=101", { base: PROXY, session: api })).status).toBe(400);
    expect((await call("/invoices?limit=1000000", { base: PROXY, session: api })).status).toBe(400);

    const inv = await invoice(), stu = await studentRequest();
    const bodies = [
      first.text, second.text, (await call(`/workspaces/${ids[0]}`, { base: PROXY, session: api })).text,
      (await call("/invoices", { base: PROXY, session: api })).text, (await call(`/invoices/${inv.id}`, { base: PROXY, session: api })).text,
      (await call("/student-requests", { base: PROXY, session: api })).text, (await call(`/student-requests/${stu.id}`, { base: PROXY, session: api })).text,
      (await call("/audit?limit=100", { base: PROXY, session: api })).text, (await call("/me", { base: PROXY, session: api })).text,
    ].join("\n");
    for (const forbidden of ["secret-key-", "secret-hook-", "api_key", "webhook_secret", "password_hash", "token_hash", "mfa_secret", "enrollment_code", "recovery", "$2a$", "$2b$"]) expect(bodies, forbidden).not.toContain(forbidden);
  });

  test("audit range is capped at 90 days and a malformed range is rejected", async () => {
    const api = await apiSignIn(await createOperator());
    const wide = await call(`/audit?from=${encodeURIComponent("2026-01-01T00:00:00Z")}&to=${encodeURIComponent("2026-09-01T00:00:00Z")}`, { base: PROXY, session: api });
    expect(wide.status).toBe(400);
    expect((await call("/audit?from=yesterday", { base: PROXY, session: api })).status).toBe(400);
  });

  test("password guessing is throttled per account and per address, without revealing whether the account exists", async () => {
    await resetLimits();
    const op = await createOperator();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await call("/auth/login", { method: "POST", body: { email: op.email, password: `wrong-password-${i}-xx` } })).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
    // Even the right password is refused while throttled; and an unknown account behaves like a known one.
    expect((await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } })).status).toBe(429);
    const ghost = await call("/auth/login", { method: "POST", body: { email: "nobody@example.test", password: "whatever-password-1" } });
    expect([401, 429]).toContain(ghost.status);
    await resetLimits();
  });
});
