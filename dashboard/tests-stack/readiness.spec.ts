import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { directCustomer, db } from "./support/stack";

const API = `http://127.0.0.1:${process.env["STACK_API_PORT"] ?? "13310"}/api/v1`;
interface ResponseBody {
  data: {
    recommended_level?: number | null;
    selected_level?: number;
    event_id?: string;
    readiness?: { selected_level: number; levels: Array<{ missions: Array<{ id: string; status: string }> }> };
    result?: string;
    checks?: Array<{ id: string; passed: boolean }>;
    levels?: Array<{ missions: Array<{ id: string; status: string }> }>;
  };
}

async function call(token: string, workspace: string, route: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${API}${route}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace": workspace,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json() as ResponseBody };
}

test("workspace readiness is tenant-scoped, Owner-gated and bypass audit is append-only/idempotent", async () => {
  const owner = await directCustomer();
  const developer = await directCustomer();
  await db.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'developer')", [developer.userId, owner.tenant]);

  const initial = await call(owner.token, owner.tenant, "/readiness/levels");
  expect(initial.status).toBe(200);
  expect(initial.body.data.recommended_level).toBeNull();
  expect(initial.body.data.levels[0].missions.find((mission: { id: string }) => mission.id === "webhook_configured").status).toBe("not_applicable");

  const manualConfirm = await call(developer.token, owner.tenant, "/readiness/missions/risk_reviewed/confirm", { method: "POST", body: { status: "completed" } });
  expect(manualConfirm.status).toBe(403);
  const bypassDenied = await call(developer.token, owner.tenant, "/readiness/levels/bypass", {
    method: "POST", body: { target_level: 1, reason: "not owner", dialog_version: "level-bypass-v1", idempotency_key: randomUUID() },
  });
  expect(bypassDenied.status).toBe(403);
  const testMissionDenied = await call(developer.token, owner.tenant, "/readiness/missions/webhook_simulation/run", { method: "POST", body: {} });
  expect(testMissionDenied.status).toBe(403);

  const simulation = await call(owner.token, owner.tenant, "/readiness/missions/webhook_simulation/run", { method: "POST", body: {} });
  expect(simulation.status).toBe(201);
  expect(simulation.body.data.result).toBe("passed");
  expect(simulation.body.data.checks?.every((check) => check.passed)).toBe(true);
  expect(simulation.body.data.readiness?.levels[0]?.missions.find((mission) => mission.id === "webhook_simulation")?.status).toBe("completed");
  expect((await db.query("SELECT count(*)::int AS n FROM workspace_mission_test_runs WHERE tenant_id=$1", [owner.tenant])).rows[0].n).toBe(1);

  const wrongTabletop = await call(owner.token, owner.tenant, "/readiness/missions/incident_tabletop/run", { method: "POST", body: { answer: "resume_worker" } });
  expect(wrongTabletop.status).toBe(201);
  expect(wrongTabletop.body.data.result).toBe("failed");
  const rightTabletop = await call(owner.token, owner.tenant, "/readiness/missions/incident_tabletop/run", { method: "POST", body: { answer: "pause_and_escalate" } });
  expect(rightTabletop.status).toBe(201);
  expect(rightTabletop.body.data.result).toBe("passed");

  const unsupportedSimulation = await call(owner.token, owner.tenant, "/readiness/missions/risk_reviewed/run", { method: "POST", body: {} });
  expect(unsupportedSimulation.status).toBe(400);

  const confirmed = await call(owner.token, owner.tenant, "/readiness/missions/risk_reviewed/confirm", { method: "POST", body: { status: "completed" } });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.data.recommended_level).toBeNull(); // device evidence is still absent
  await db.query("INSERT INTO devices(tenant_id,device_key,label) VALUES ($1,$2,'Readiness test')", [owner.tenant, `RDY-${randomUUID().slice(0, 8)}`]);
  const levelZero = await call(owner.token, owner.tenant, "/readiness/levels");
  expect(levelZero.body.data.recommended_level).toBe(0);

  const payload = { target_level: 1, reason: "Kontrol workspace sudah ditinjau", dialog_version: "level-bypass-v1", idempotency_key: randomUUID() };
  const first = await call(owner.token, owner.tenant, "/readiness/levels/bypass", { method: "POST", body: payload });
  expect(first.status).toBe(201);
  expect(first.body.data.readiness.selected_level).toBe(1);
  const replay = await call(owner.token, owner.tenant, "/readiness/levels/bypass", { method: "POST", body: payload });
  expect(replay.status).toBe(200);
  expect(replay.body.data.event_id).toBe(first.body.data.event_id);
  const reusedKey = await call(owner.token, owner.tenant, "/readiness/levels/bypass", { method: "POST", body: { ...payload, reason: "Alasan berbeda" } });
  expect(reusedKey.status).toBe(409);
  expect((await db.query("SELECT count(*)::int AS n FROM workspace_level_events WHERE tenant_id=$1", [owner.tenant])).rows[0].n).toBe(1);

  const crossTenant = await call(developer.token, randomUUID(), "/readiness/levels");
  expect(crossTenant.status).toBe(401);
});
