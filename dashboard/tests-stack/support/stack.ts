import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { expect, type Page } from "@playwright/test";
import { login } from "../../../src/api-gateway/services/account.service";
import { createTrial } from "../../../src/api-gateway/services/billing.service";

/** Everything here talks to the disposable database and the local harness only; it refuses anything else. */
const databaseUrl = process.env["DATABASE_URL"] ?? "";
const parsed = databaseUrl ? new URL(databaseUrl) : null;
if (!parsed || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/operator_test") {
  throw new Error("STACK tests run only through scripts/test-operator-stack.sh against the disposable local database.");
}
export const db = new Pool({ connectionString: databaseUrl, max: 4 });
const WEB = process.env["STACK_WEB_PORT"] ?? "13200", API_PORT = process.env["STACK_API_PORT"] ?? "13210", CTL = process.env["STACK_CTL_PORT"] ?? "13211";
export const API = `http://127.0.0.1:${API_PORT}/operator`; // straight to the API (no proxy)
export const PROXY = `http://localhost:${WEB}/api/operator`; // through the dashboard proxy, like the browser
export const ORIGIN = `http://localhost:${WEB}`;
export const CTL_URL = `http://127.0.0.1:${CTL}`;
export const COOKIE = "__Host-koneva_op";
export const PASSWORD = "synthetic-test-password-26";
export const ALL = ["payments:read", "payments:confirm", "students:read", "students:decide", "workspaces:read", "audit:read"];
const mfaKey = Buffer.from(process.env["OPERATOR_MFA_ENC_KEY"] ?? "", "base64");

// Independent RFC 6238 implementation: if it disagrees with the backend, the login below fails.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32Decode = (text: string): Buffer => {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of text.replace(/[\s=]/g, "").toUpperCase()) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};
export const stepNow = (offset = 0) => Math.floor(Date.now() / 30_000) + offset;
export function totp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const o = mac[mac.length - 1]! & 15;
  const n = ((mac[o]! & 0x7f) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}
function encrypt(plain: Buffer, operatorId: string): string {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", mfaKey, iv); c.setAAD(Buffer.from(operatorId));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export interface Op { id: string; email: string; secret: Buffer; used: number; enrollmentCode?: string }
const passwordHash = bcrypt.hashSync(PASSWORD, 10);
export async function createOperator(permissions = ALL, options: { mfa?: boolean; enrollmentCode?: string } = {}): Promise<Op> {
  const id = randomUUID(), email = `${id}@example.test`, secret = randomBytes(20), mfa = options.mfa ?? true;
  await db.query(
    `INSERT INTO operators(id,email,name,password_hash,permissions,mfa_secret_enc,mfa_enrolled_at,enrollment_code_hash,enrollment_code_expires_at)
     VALUES ($1,$2,'Operator Uji',$3,$4,$5,$6,$7,$8)`,
    [id, email, passwordHash, permissions, mfa ? encrypt(secret, id) : null, mfa ? new Date() : null,
      options.enrollmentCode ? createHmacHash(options.enrollmentCode) : null, options.enrollmentCode ? new Date(Date.now() + 3_600_000) : null]);
  const op: Op = { id, email, secret, used: 0 };
  if (options.enrollmentCode) op.enrollmentCode = options.enrollmentCode;
  return op;
}
// codeHash() of the backend: sha256 of a fixed prefix plus the normalised code.
import { createHash } from "node:crypto";
function createHmacHash(code: string): string { return createHash("sha256").update(`koneva-operator-code-v1:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`).digest("hex"); }

/** A code the server has not seen yet: steps only move forward; waits for the next window when the +1 slack is used up. */
export async function nextCode(op: Op): Promise<string> {
  const wanted = Math.max(stepNow(), op.used + 1);
  if (wanted > stepNow(1)) await new Promise((r) => setTimeout(r, (wanted - stepNow(1)) * 30_000 - (Date.now() % 30_000) + 200));
  op.used = wanted;
  return totp(op.secret, wanted);
}

/** Login buckets are per IP and every test comes from 127.0.0.1; the throttling itself is tested in auth.spec.ts. */
export const resetLimits = () => db.query("DELETE FROM operator_login_attempts");

export async function signInBrowser(page: Page, op: Op, options: { password?: string } = {}): Promise<void> {
  await resetLimits();
  await page.goto("/operator/login");
  await page.getByLabel("Email").fill(op.email);
  await page.getByLabel("Kata sandi").fill(options.password ?? PASSWORD);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByLabel("Kode verifikasi").fill(await nextCode(op));
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await expect(page).toHaveURL(/\/operator$/);
}

export interface ApiSession { cookie: string; csrf: string }
export async function call(route: string, o: { base?: string; session?: ApiSession; method?: string; body?: unknown; key?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, "X-Requested-With": "koneva-operator", ...o.headers };
  if (o.session) { headers["Cookie"] = o.session.cookie; headers["X-CSRF-Token"] = o.session.csrf; }
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.key) headers["Idempotency-Key"] = o.key;
  Object.assign(headers, o.headers);
  const r = await fetch((o.base ?? API) + route, { method: o.method ?? "GET", headers, redirect: "manual", ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
  const text = await r.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: response shapes are asserted at the call site
  let body: any; try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  return { status: r.status, headers: r.headers, text, body };
}
export async function apiSignIn(op: Op): Promise<ApiSession> {
  await resetLimits();
  const a = await call("/auth/login", { method: "POST", body: { email: op.email, password: PASSWORD } });
  expect(a.status, a.text).toBe(200);
  const b = await call("/auth/mfa/verify", { method: "POST", body: { challenge_id: a.body.data.challenge_id, code: await nextCode(op) } });
  expect(b.status, b.text).toBe(200);
  return { cookie: b.headers.get("set-cookie")!.split(";")[0]!, csrf: b.body.data.csrf_token };
}

export async function fault(mode: "drop" | "html502" | "redirect" | "none") {
  await fetch(`${CTL_URL}/fault`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
}
export const faultsApplied = async (): Promise<number> => ((await (await fetch(`${CTL_URL}/fault`)).json()) as { applied: number }).applied;

export async function workspace(name = "Kelas Contoh") {
  const id = randomUUID();
  await db.query("INSERT INTO tenants(id,name,email,api_key,webhook_secret,used_messages) VALUES ($1,$2,$3,$4,$5,50)", [id, `${name} ${id.slice(0, 6)}`, `${id}@example.test`, `secret-key-${id}`, `secret-hook-${id}`]);
  return id;
}
export async function invoice(amount = 99000) {
  const tenant = await workspace(), id = randomUUID(), number = `STK-${id.slice(0, 18)}`;
  await db.query("INSERT INTO invoices(id,tenant_id,number,plan_id,cycle,amount_idr,due_at) VALUES ($1,$2,$3,'umkm','monthly',$4,now()+interval '7 days')", [id, tenant, number, amount]);
  return { id, tenant, number };
}
export async function studentRequest(note = "Catatan pribadi mahasiswa NIM 998877") {
  const tenant = await workspace("Pelajar"), id = randomUUID();
  await db.query("INSERT INTO student_requests(id,tenant_id,requester_email,note) VALUES ($1,$2,'mahasiswa@kampus.example.ac.id',$3)", [id, tenant, note]);
  return { id, tenant };
}
export const invoiceRow = async (id: string) => (await db.query("SELECT status, paid_at, version FROM invoices WHERE id=$1", [id])).rows[0];
export const auditCount = async (targetId: string) => Number((await db.query("SELECT count(*) FROM operator_audit WHERE target_id=$1", [targetId])).rows[0].count);

// ---- Customer accounts (roles and invitations) -------------------------------------------------------------------------
import fs from "node:fs";
export const CUSTOMER_PASSWORD = "synthetic-customer-pass-26";
export interface Customer { email: string; token: string; userId: string; tenant: string }
let signupIpCounter = 1;
/** A real sign-up and mailbox OTP through the API. The workspace gets a paid plan for role tests. */
export async function customer(email = `${randomUUID()}@gmail.com`, verified = true): Promise<Customer> {
  await emailMode("dev-outbox");
  const r = await fetch(`${ORIGIN}/auth/signup`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${++signupIpCounter}` },
    body: JSON.stringify({ email, password: CUSTOMER_PASSWORD, name: "Pemilik Uji", accept_terms: true }),
  });
  const pending = (await r.json()) as { data: { verification_required: true; email: string } };
  if (r.status !== 202) throw new Error(`signup failed: ${r.status}`);
  const code = latestOtp(email);
  if (!code) throw new Error("signup verification OTP was not written to the test outbox");
  const confirmation = await fetch(`${ORIGIN}/auth/signup/verification/confirm`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${++signupIpCounter}` },
    body: JSON.stringify({ email: pending.data.email, code }),
  });
  const body = (await confirmation.json()) as { data: { token: string; user: { id: string }; workspaces: Array<{ id: string }> } };
  if (confirmation.status !== 200) throw new Error(`signup verification failed: ${confirmation.status}`);
  const tenant = body.data.workspaces[0]!.id;
  if (!verified) await db.query("UPDATE users SET email_verified_at = NULL WHERE id=$1", [body.data.user.id]);
  await db.query("UPDATE subscriptions SET plan_id='umkm', status='active', period_end=now()+interval '30 days' WHERE tenant_id=$1", [tenant]);
  return { email, token: body.data.token, userId: body.data.user.id, tenant };
}
/** Direct, already-verified fixture for billing browser tests that do not exercise public signup. */
export async function directCustomer(email = `${randomUUID()}@gmail.com`, verified = true): Promise<Customer> {
  const userId = randomUUID(), tenant = randomUUID();
  await db.query(
    `INSERT INTO users(id,email,name,password_hash,status,email_verified_at)
     VALUES ($1,$2,'Pemilik Uji',$3,'active',$4)`,
    [userId, email, await bcrypt.hash(CUSTOMER_PASSWORD, 12), verified ? new Date() : null],
  );
  await db.query(
    "INSERT INTO tenants(id,name,email,api_key,webhook_secret) VALUES ($1,'Workspace Uji',$2,$3,$4)",
    [tenant, email, `wg_${randomBytes(24).toString("hex")}`, `whsec_${randomBytes(24).toString("hex")}`],
  );
  await createTrial(db, tenant);
  await db.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'owner')", [userId, tenant]);
  const session = await login(email, CUSTOMER_PASSWORD, {});
  return { email, token: session.token, userId, tenant };
}
export async function asCustomer(page: Page, who: Customer, workspace: string = who.tenant): Promise<void> {
  await page.addInitScript(([token, ws]) => { window.localStorage.setItem("wa_gateway_session", token!); window.localStorage.setItem("wa_gateway_workspace", ws!); }, [who.token, workspace]);
}
export function latestOtp(to: string): string | undefined {
  const file = process.env["DEV_EMAIL_OUTBOX_FILE"];
  if (!file || !fs.existsSync(file)) return undefined;
  const mails = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; code: string }).filter((m) => m.to === to);
  return mails.at(-1)?.code;
}
export async function emailMode(mode: "none" | "dev-outbox") {
  await fetch(`${CTL_URL}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
}
export const managerCalls = async (): Promise<string[]> => ((await (await fetch(`${CTL_URL}/manager-calls`)).json()) as { calls: string[] }).calls;
