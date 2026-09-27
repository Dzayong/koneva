/** Compiles each operator route once (dev server compiles on first hit) so tests do not time out on cold pages. */
export default async function globalSetup(): Promise<void> {
  const base = "http://localhost:13100";
  for (const path of ["/operator/login", "/operator", "/operator/payments", "/operator/payments/inv-1", "/operator/students", "/operator/students/req-1", "/operator/workspaces/w-1", "/operator/audit"]) {
    await fetch(`${base}${path}`).catch(() => undefined);
  }
}
