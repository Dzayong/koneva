import { expect, test } from "@playwright/test";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("responsive, theme and motion (UI evidence)", () => {
  for (const path of [
    "/operator",
    "/operator/payments",
    "/operator/payments/inv-1",
    "/operator/students",
    "/operator/students/req-1",
    "/operator/audit",
    "/operator/insights",
    "/operator/insights/devices",
    "/operator/insights/devices/device-1",
    "/operator/insights/health",
    "/operator/insights/workspaces",
    "/operator/insights/workspaces/w-1",
    "/operator/system/whatsapp-otp",
  ]) {
    test(`no horizontal page scroll at phone widths: ${path}`, async ({ page }) => {
      await installOperatorMock(page, freshState());
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      for (const width of [320, 375, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(() => ({
          pageFits: document.documentElement.scrollWidth <= innerWidth,
          elements: [...document.querySelectorAll("body *")]
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className : "",
              text: element.textContent?.trim().slice(0, 50) ?? "",
              right: Math.round(element.getBoundingClientRect().right),
              width: Math.round(element.getBoundingClientRect().width),
            }))
            .filter((element) => element.right > innerWidth + 1)
            .slice(0, 5),
        }));
        expect(overflow.pageFits, `page overflows horizontally at ${width}px on ${path}: ${JSON.stringify(overflow.elements)}`).toBe(true);
      }
    });
  }

  test("dark mode renders the confirmation dialog readable and reduced motion still works", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await installOperatorMock(page, freshState());
    await page.goto("/operator/payments/inv-1");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await context.close();
  });

  test("operator pages advertise no-index in metadata", async ({ page }) => {
    await installOperatorMock(page, freshState({ authenticated: false }));
    await page.goto("/operator/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
