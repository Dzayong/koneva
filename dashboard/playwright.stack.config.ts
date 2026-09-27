import { defineConfig, devices } from "@playwright/test";

/**
 * STACK-local tests for the Operator Panel: real PostgreSQL (disposable container), the real operator router, the real Next
 * proxy and real cookies. Started by `scripts/test-operator-stack.sh` (repo root), which owns the database and the harness.
 * Evidence level: STACK-local. Never LIVE: no production data, no WhatsApp, no payment gateway.
 */
const WEB = process.env["STACK_WEB_PORT"] ?? "13200";
export default defineConfig({
  testDir: "./tests-stack",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB}`, trace: "off", launchOptions: { args: ["--no-sandbox"] } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${WEB}`,
    url: `http://localhost:${WEB}/operator/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: ".next-stack", NEXT_PUBLIC_API_URL: "", INTERNAL_API_URL: process.env["INTERNAL_API_URL"] ?? `http://127.0.0.1:${process.env["STACK_API_PORT"] ?? "13210"}` },
  },
});
