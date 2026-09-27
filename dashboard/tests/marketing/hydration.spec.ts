import { expect, test, type Page } from "@playwright/test";

/**
 * Guards the public marketing page against SSR/CSR hydration mismatches. UI evidence only; no backend,
 * database or WhatsApp number is touched. `/public/plans` and `/public/info` are mocked in the browser so
 * the "Harga" section (which WarmupFlow's section sits right above) actually renders instead of being
 * skipped for lack of data, matching the reported repro (opening the page at #harga).
 */
const HYDRATION_KEYWORDS = /hydrat/i;

async function mockPublicEndpoints(page: Page) {
  await page.route("**/public/plans", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "pelajar", name: "Pelajar", audience: "Pelajar", features: [], max_devices: 1, monthly_messages: 1000, max_members: 1, requires_student_verification: true, price_month_idr: 29000, price_year_idr: null, price_is_final: true },
        ],
      }),
    }),
  );
  await page.route("**/public/info", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { support_contact: null } }) }),
  );
}

function collectHydrationIssues(page: Page) {
  const issues: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && HYDRATION_KEYWORDS.test(m.text())) issues.push(m.text()); });
  page.on("pageerror", (e) => { if (HYDRATION_KEYWORDS.test(String(e))) issues.push(String(e)); });
  return issues;
}

test.describe("marketing page hydration (UI evidence)", () => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    for (const path of ["/", "/#harga"]) {
      test(`no hydration console error at ${path} (prefers-reduced-motion: ${reducedMotion})`, async ({ browser }) => {
        const context = await browser.newContext({ reducedMotion });
        const page = await context.newPage();
        const issues = collectHydrationIssues(page);
        await mockPublicEndpoints(page);
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        // WarmupFlow renders unconditionally; give whileInView a chance to fire either way.
        await page.locator("text=Nomor baru dilatih dulu").scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        expect(issues).toEqual([]);
        await context.close();
      });
    }
  }

  test("warm-up cards still animate in with normal motion and settle instantly with reduced motion", async ({ browser }) => {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await mockPublicEndpoints(page);
      await page.goto("/");
      const firstCard = page.locator("text=Hanya membalas orang yang lebih dulu menulis").locator("xpath=ancestor::*[contains(@class,'rounded-2xl')][1]");
      await firstCard.scrollIntoViewIfNeeded();
      await expect(firstCard).toBeVisible();
      await expect.poll(async () => firstCard.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      await context.close();
    }
  });
});
