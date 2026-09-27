import { expect, test } from "@playwright/test";
import { wibDayEndExclusiveUtc, wibDayStartUtc } from "../../src/lib/operator/dates";
import { freshState, installOperatorMock } from "../support/operator-mock";

test.describe("WIB day boundaries", () => {
  test("a WIB day is [00:00 WIB, 00:00 WIB next day) expressed in UTC", () => {
    expect(wibDayStartUtc("2026-09-26")).toBe("2026-09-25T17:00:00.000Z");
    expect(wibDayEndExclusiveUtc("2026-09-26")).toBe("2026-09-26T17:00:00.000Z");
    expect(wibDayStartUtc("2026-01-01")).toBe("2025-12-31T17:00:00.000Z"); // across a year boundary
    expect(wibDayEndExclusiveUtc("2026-12-31")).toBe("2026-12-31T17:00:00.000Z");
    expect(wibDayEndExclusiveUtc("2028-02-28")).toBe("2028-02-28T17:00:00.000Z"); // leap year: next day is the 29th
    expect(() => wibDayStartUtc("26-09-2026")).toThrow();
  });

  test("the audit filter sends inclusive-start / exclusive-end UTC instants for the chosen WIB days", async ({ page }) => {
    const state = freshState();
    await installOperatorMock(page, state);
    await page.goto("/operator/audit");
    await page.getByLabel("Dari (tanggal WIB)").fill("2026-09-26");
    await page.getByLabel("Sampai (tanggal WIB, termasuk)").fill("2026-09-26");
    await expect.poll(() => state.requests.some((r) => r.path === "/audit" && r.query.includes("from=2026-09-25T17%3A00%3A00.000Z") && r.query.includes("to=2026-09-26T17%3A00%3A00.000Z"))).toBe(true);
    expect(state.requests.some((r) => r.query.includes("23%3A59%3A59"))).toBe(false);
  });
});

test.describe("student privacy in the browser (UI evidence)", () => {
  const NOTE = "Catatan pribadi mahasiswa NIM 998877 PRIBADI";
  test("private notes and decision reasons stay out of console output, page errors and non-operator requests", async ({ page }) => {
    const state = freshState();
    state.students[0]!.note = NOTE;
    const console_: string[] = []; const errors: string[] = []; const outside: string[] = [];
    page.on("console", (m) => console_.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => { const u = new URL(r.url()); if (u.hostname !== "localhost" || u.pathname.startsWith("/api/operator") === false && !/^\/(operator|_next|__nextjs)/.test(u.pathname)) outside.push(`${r.method()} ${u.pathname}`); });
    await installOperatorMock(page, state);
    await page.goto("/operator/students/req-1");
    await expect(page.getByText(NOTE)).toBeVisible();
    await page.getByRole("button", { name: "Putuskan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Tolak").check();
    await dialog.getByLabel(/Alasan/).fill("Alasan rahasia penolakan XYZ");
    await dialog.getByRole("button", { name: "Tolak" }).last().click();
    await expect(dialog.getByText(/Keputusan tercatat/)).toBeVisible();
    for (const text of [...console_, ...errors]) { expect(text).not.toContain("NIM 998877"); expect(text).not.toContain("rahasia penolakan"); }
    expect(outside.filter((o) => !o.startsWith("GET /_next") && !o.includes("/operator"))).toEqual([]);
    // The note is only ever sent to the browser by the detail endpoint, never placed in a URL.
    for (const r of state.requests) { expect(r.path + r.query).not.toContain("NIM"); }
    expect(state.requests.filter((r) => r.path === "/student-requests").every((r) => !JSON.stringify(r).includes("NIM 998877"))).toBe(true);
  });

  test("error messages never echo server-supplied text for validation failures", async ({ page }) => {
    const state = freshState({ decideMode: "not_pending" });
    await installOperatorMock(page, state);
    await page.goto("/operator/students/req-1");
    await page.getByRole("button", { name: "Putuskan" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Setujui" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).not.toContainText("Mahasiswa semester 5");
  });
});
