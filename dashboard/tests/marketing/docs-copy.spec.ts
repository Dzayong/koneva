import { expect, test } from "@playwright/test";

test("API docs keep code readable and copy the selected example", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs");

  const code = page.locator("pre code").first();
  await expect(code).toBeVisible();
  const style = await code.evaluate((element) => ({
    codeBackground: getComputedStyle(element).backgroundColor,
    contrast: (() => {
      const context = document.createElement("canvas").getContext("2d")!;
      const rgb = (value: string) => {
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      };
      const luminance = (value: string) => {
        const [red, green, blue] = rgb(value);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(element.parentElement!.parentElement!).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    })(),
  }));
  expect(style.contrast).toBeGreaterThan(7);
  expect(style.codeBackground).toBe("rgba(0, 0, 0, 0)");

  const example = await code.innerText();
  const copyButton = page.getByRole("button", { name: "Salin" }).first();
  await copyButton.click();
  await expect(page.getByRole("button", { name: "Tersalin" }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(example);
});

test("API docs copy still works when clipboard permission is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("clipboard permission denied"); } },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string) => {
        if (command !== "copy") return false;
        (window as Window & { __copiedExample?: string }).__copiedExample = document.querySelector("textarea")?.value;
        return true;
      },
    });
  });

  await page.goto("/docs");
  const example = await page.locator("pre code").first().innerText();
  await page.getByRole("button", { name: "Salin" }).first().click();
  await expect(page.getByRole("button", { name: "Tersalin" }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __copiedExample?: string }).__copiedExample)).toBe(example);
});
