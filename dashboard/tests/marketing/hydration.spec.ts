import { expect, test, type Page } from "@playwright/test";

/**
 * Guards the public marketing page against SSR/CSR hydration mismatches. UI evidence only; no backend,
 * database or WhatsApp number is touched. `/public/plans` and `/public/info` are mocked in the browser so
 * pricing cards and the initial #harga anchor can be checked deterministically.
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
  test("the #harga target stays present and shows loaded plan prices", async ({ page }) => {
    await mockPublicEndpoints(page);
    await page.goto("/#harga");

    const pricing = page.locator("#harga");
    await expect(pricing).toBeVisible();
    await expect(pricing.getByRole("heading", { name: "Pelajar" })).toBeVisible();
    await expect(pricing).toContainText("Rp 29.000/bulan");
  });

  test("terms and privacy show the new monthly catalog and honest consent/retention limits", async ({ page }) => {
    await mockPublicEndpoints(page);
    await page.goto("/syarat");
    const terms = page.locator("article");
    await expect(terms).toContainText("Pelajar Rp29.000");
    await expect(terms).toContainText("Asisten Pribadi Rp59.000");
    await expect(terms).toContainText("Tim UKM Rp99.000");
    await expect(terms).toContainText("Bisnis CS Rp199.000");
    await expect(terms).toContainText("fair-use");
    await expect(terms).toContainText("tidak otomatis dikecualikan");
    await expect(terms).toContainText("365 hari terakhir");
    await expect(terms).toContainText("tidak berlaku untuk pesan urgent");
    await expect(terms).toContainText("Status aktif atau jeda tidak mengubah harga khusus itu");
    await expect(page.getByText("Draf untuk ditinjau.")).toBeVisible();

    await page.goto("/privasi");
    const privacy = page.locator("article");
    await expect(privacy).toContainText("Pelajar Rp29.000");
    await expect(privacy).toContainText("Asisten Pribadi Rp59.000");
    await expect(privacy).toContainText("Tim UKM Rp99.000");
    await expect(privacy).toContainText("Rp199.000");
    await expect(privacy).toContainText("20.000 pesan/bulan (±667/hari)");
    await expect(privacy).toContainText("tidak mencatat bukti consent");
    await expect(privacy).toContainText("tidak menjadi daftar blokir yang dikelola pelanggan lintas perangkat");
    await expect(privacy).toContainText("Backup dan salinan pemulihan");
    await expect(page.getByText("Draf untuk ditinjau.")).toBeVisible();
  });

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
