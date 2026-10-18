import { expect, test } from "@playwright/test";

const owner = {
  success: true,
  data: {
    user: { id: "owner-1", email: "owner@example.test", name: "Owner Uji", email_verified: true },
    workspace: { id: "workspace-1", name: "Workspace Uji", role: "owner" },
    workspaces: [{ id: "workspace-1", name: "Workspace Uji", role: "owner" }],
    permissions: ["devices:read", "team:manage"], subscription: null, support_contact: null,
  },
};

function readiness(riskReviewed = false, webhookSimulation = false) {
  const at = "2026-10-17T09:00:00.000Z";
  const missions = [
    { id: "device_registered", level: 0, title: "Daftarkan device", description: "Minimal satu device tercatat.", kind: "automatic", source: "devices", status: "completed", reason: null, confirmed_at: null, observed_at: at },
    { id: "risk_reviewed", level: 0, title: "Pahami risiko koneksi", description: "Pahami risiko dan cara memutus sesi.", kind: "manual", source: "Konfirmasi Owner", status: riskReviewed ? "completed" : "needs_action", reason: null, confirmed_at: riskReviewed ? at : null, observed_at: at },
    { id: "webhook_simulation", level: 0, title: "Jalankan simulasi webhook", description: "Payload sintetis lokal.", kind: "test", source: "Simulator lokal", status: webhookSimulation ? "completed" : "needs_action", reason: webhookSimulation ? "Simulasi lulus (3/3); tanpa koneksi eksternal atau pengiriman pesan." : null, confirmed_at: webhookSimulation ? at : null, observed_at: at },
    { id: "webhook_configured", level: 0, title: "Siapkan webhook (opsional)", description: "Opsional.", kind: "automatic", source: "tenants.webhook_url", status: "not_applicable", reason: "Webhook bersifat opsional.", confirmed_at: null, observed_at: at },
  ];
  const incidentMission = { id: "incident_tabletop", level: 4, title: "Jalankan tabletop insiden", description: "Pilih tindakan untuk skenario sintetis.", kind: "test", source: "Simulator lokal", status: "needs_action", reason: null, confirmed_at: null, observed_at: at };
  return {
    recommended_level: riskReviewed && webhookSimulation ? 0 : null,
    selected_level: riskReviewed && webhookSimulation ? 0 : null,
    selected_by_owner: false,
    evaluated_at: at,
    levels: [0, 1, 2, 3, 4].map((level) => ({
      level,
      name: ["Siap Disiapkan", "Siap Uji Terbatas", "Siap Kelola Kampanye", "Siap untuk Notifikasi", "Siap Operasional CS"][level],
      missions: level === 0 ? missions : level === 4 ? [incidentMission] : [],
      completed: level === 0 ? missions.filter((mission) => mission.status !== "needs_action").length : 0,
      total: level === 0 ? missions.length : level === 4 ? 1 : 0,
    })),
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wa_gateway_session", "wgs_synthetic_test_session");
    window.localStorage.setItem("wa_gateway_workspace", "workspace-1");
  });
  await page.route("**/auth/me", (route) => route.fulfill({ json: owner }));
});

test("workspace checklist distinguishes missing evidence and confirms manual review", async ({ page }) => {
  let confirmed = false;
  let simulated = false;
  await page.route("**/api/v1/readiness/levels", (route) => route.fulfill({ json: { success: true, data: readiness(confirmed, simulated) } }));
  await page.route("**/api/v1/readiness/missions/risk_reviewed/confirm", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ status: "completed" });
    confirmed = true;
    await route.fulfill({ json: { success: true, data: readiness(true) } });
  });
  await page.route("**/api/v1/readiness/missions/webhook_simulation/run", async (route) => {
    simulated = true;
    await route.fulfill({ json: { success: true, data: { result: "passed", checks: [{ id: "event", passed: true }], readiness: readiness(confirmed, true) } }, status: 201 });
  });

  await page.goto("/readiness");
  await expect(page.getByText("Belum ada level yang direkomendasikan")).toBeVisible();
  await expect(page.getByText("Webhook bersifat opsional.")).toBeVisible();
  await page.getByRole("button", { name: "Saya sudah meninjau" }).click();
  await expect(page.getByText("Belum ada level yang direkomendasikan")).toBeVisible();
  await page.getByRole("region", { name: /Level 0/ }).getByRole("button", { name: "Jalankan simulasi aman" }).click();
  await expect(page.getByText(/Rekomendasi Level 0/)).toBeVisible();
  await expect(page.getByLabel("Pilihan tindakan simulasi insiden")).toBeVisible();
});

test("Owner bypass requires an explicit reason and shows scope limits before submit", async ({ page }) => {
  let bypassBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/readiness/levels", (route) => route.fulfill({ json: { success: true, data: readiness(true, true) } }));
  await page.route("**/api/v1/readiness/levels/bypass", async (route) => {
    bypassBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { success: true, data: { event_id: "event-1", target_level: 1, idempotent_replay: false, readiness: { ...readiness(true), selected_level: 1, selected_by_owner: true } } }, status: 201 });
  });

  await page.goto("/readiness");
  await page.getByLabel("Level pilihan").selectOption("1");
  await page.getByLabel("Alasan pilihan (minimal 5 karakter)").fill("Review internal selesai");
  await page.getByRole("button", { name: "Tinjau dan pilih level" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/tidak memverifikasi bahwa nomor disetujui WhatsApp\/Meta/)).toBeVisible();
  await expect(dialog.getByText(/tidak mengubah paket, kuota, rate limit, consent\/opt-out/)).toBeVisible();
  await dialog.getByRole("button", { name: "Pilih level ini" }).click();
  await expect.poll(() => bypassBody).not.toBeNull();
  const submitted = bypassBody as Record<string, unknown> | null;
  expect(submitted).toMatchObject({ target_level: 1, reason: "Review internal selesai", dialog_version: "level-bypass-v1" });
  expect(submitted?.idempotency_key).toEqual(expect.any(String));
});

test("non-Owner can read the checklist but cannot confirm missions or bypass", async ({ page }) => {
  await page.route("**/auth/me", (route) => route.fulfill({ json: {
    ...owner,
    data: { ...owner.data, workspace: { ...owner.data.workspace, role: "developer" } },
  } }));
  await page.route("**/api/v1/readiness/levels", (route) => route.fulfill({ json: { success: true, data: readiness(false) } }));
  await page.goto("/readiness");
  await expect(page.getByText("Belum ada level yang direkomendasikan")).toBeVisible();
  await expect(page.getByRole("button", { name: "Saya sudah meninjau" })).toHaveCount(0);
  await expect(page.getByText("Pilih level di atas rekomendasi")).toHaveCount(0);
});
