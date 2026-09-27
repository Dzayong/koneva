import { expect, type Page } from "@playwright/test";
import { installOperatorMock, type MockState } from "./operator-mock";

export async function openInvoice(page: Page, state: MockState, id = "inv-1") {
  await installOperatorMock(page, state);
  await page.goto(`/operator/payments/${id}`);
  await expect(page.getByRole("button", { name: "Konfirmasi pembayaran" })).toBeEnabled();
}
export async function toReview(page: Page, reference = "TRF-0001") {
  await page.getByRole("button", { name: "Konfirmasi pembayaran" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Referensi (opsional)").fill(reference);
  await dialog.getByLabel(/Saya sudah memeriksa bukti/).check();
  await dialog.getByRole("button", { name: "Periksa ulang" }).click();
  await expect(dialog.getByText("Periksa ulang sebelum mengirim")).toBeVisible();
  return dialog;
}
export const confirmPosts = (s: MockState) => s.requests.filter((r) => r.method === "POST" && r.path.endsWith("/confirm-payment"));
