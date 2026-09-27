import { defineConfig, devices } from "@playwright/test";

/**
 * Verifies the DEV sandbox banner (dashboard/src/components/dev-banner.tsx) on its own dev server instance,
 * started with KONEVA_SANDBOX=1 in this process's own env -- never in a shared build artifact or a
 * NEXT_PUBLIC_ constant -- so this config proves the banner tracks the env var, not the port number. The
 * companion "banner absent" case lives in tests/marketing/dev-banner.spec.ts under the default
 * playwright.config.ts webServer (port 13100, no KONEVA_SANDBOX), standing in for a :13000-shaped fixture
 * without ever starting or touching the real :13000 stack.
 * Port default matches the canonical DEV sandbox port (:13200); override with SANDBOX_WEB_PORT if that port is
 * already in use by something else on this machine.
 */
const WEB = process.env["SANDBOX_WEB_PORT"] ?? "13200";
export default defineConfig({
  testDir: "./tests-sandbox",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB}`, trace: "off", launchOptions: { args: ["--no-sandbox"] } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${WEB}`,
    url: `http://localhost:${WEB}/`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: ".next-sandbox", KONEVA_SANDBOX: "1" },
  },
});
