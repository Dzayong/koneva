import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated UI tests for the Operator Panel. The operator API is faked in the browser (tests/support/operator-mock.ts);
 * no backend, database, WhatsApp number or production data is touched. Evidence level of these tests: UI, never STACK/LIVE.
 * Runs its own dev server on :13100 (the deployed dashboard on :13000 is not used).
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/support/warmup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:13100",
    trace: "off",
    launchOptions: { args: ["--no-sandbox"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev -p 13100",
    url: "http://localhost:13100/operator/login",
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: ".next-ui" },
  },
});
