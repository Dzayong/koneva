import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { createDeviceSchema } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import { getDeviceStatus, listDevices, pauseDevice, resumeDevice } from '../services/device.service';

import { assertSubscriptionActive } from '../services/billing.service';

const router = Router();
const deviceParams = z.object({ deviceKey: z.string().min(1).max(32) });

export async function createDevice(request: Request, response: Response): Promise<void> {
  const tenant = request.tenant!;
  const input = request.validated!.body as z.infer<typeof createDeviceSchema>;
  await assertSubscriptionActive(pool, tenant.id);
  const payg = await pool.query<{ enabled: boolean }>('SELECT enabled FROM payg_settings WHERE singleton=true');
  const deviceCount = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM devices WHERE tenant_id = $1',
    [tenant.id],
  );

  if (!payg.rows[0]?.enabled && (deviceCount.rows[0]?.count ?? 0) >= tenant.max_devices) {
    response.status(429).json({
      success: false,
      error: {
        code: 'DEVICE_LIMIT_REACHED',
        message: `Maximum ${tenant.max_devices} devices allowed`,
      },
    });
    return;
  }

  const managerResponse = await fetch(`${config.deviceManager.url}/devices`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': config.adminApiKey,
    },
    body: JSON.stringify({ tenant_id: tenant.id, ...input }),
  });
  const result = await managerResponse.json() as Record<string, unknown>;
  if (!managerResponse.ok) {
    const upstreamError = result.error as { code?: unknown; message?: unknown } | undefined;
    response.status(managerResponse.status).json({
      success: false,
      error: {
        code: typeof upstreamError?.code === 'string' ? upstreamError.code : 'DEVICE_MANAGER_ERROR',
        message: typeof upstreamError?.message === 'string' ? upstreamError.message : 'Device Manager request failed',
      },
    });
    return;
  }

  const data = {
    device_key: result.device_key,
    status: 'starting',
    phone_number: input.phone_number ?? null,
    label: input.label ?? null,
    ...(typeof result.qr_url === 'string' ? { qr_url: result.qr_url } : {}),
  };
  response.status(201).json({ success: true, data });
}

router.post('/devices', validate({ body: createDeviceSchema }), createDevice);

router.get('/devices', async (request, response) => {
  response.json({ success: true, data: await listDevices(request.tenant!.id) });
});

router.get('/devices/:deviceKey', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  response.json({ success: true, data: await getDeviceStatus(request.tenant!.id, deviceKey) });
});

router.get('/devices/:deviceKey/media-retention', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  const row = (await pool.query<{ media_retention_days: number | null }>(
    'SELECT media_retention_days FROM devices WHERE tenant_id=$1 AND device_key=$2', [request.tenant!.id, deviceKey],
  )).rows[0];
  if (!row) { response.status(404).json({ success: false, error: { code: 'DEVICE_NOT_FOUND', message: 'Device tidak ditemukan.' } }); return; }
  response.json({ success: true, data: row });
});

router.patch('/devices/:deviceKey/media-retention', validate({
  params: deviceParams,
  body: z.object({ media_retention_days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.null()]) }).strict(),
}), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  const { media_retention_days } = request.validated!.body as { media_retention_days: number | null };
  const result = await pool.query<{ media_retention_days: number | null }>(
    `UPDATE devices SET media_retention_days=$3 WHERE tenant_id=$1 AND device_key=$2
     RETURNING media_retention_days`, [request.tenant!.id, deviceKey, media_retention_days],
  );
  if (!result.rows[0]) { response.status(404).json({ success: false, error: { code: 'DEVICE_NOT_FOUND', message: 'Device tidak ditemukan.' } }); return; }
  // Recalculate expiry for existing media from its original upload time.
  await pool.query(
    `UPDATE media_objects m SET expires_at=CASE WHEN $3::integer IS NULL THEN NULL
      ELSE m.created_at + make_interval(days => $3) END
     FROM devices d WHERE m.device_id=d.id AND d.tenant_id=$1 AND d.device_key=$2`,
    [request.tenant!.id, deviceKey, media_retention_days],
  );
  response.json({ success: true, data: result.rows[0] });
});

export async function getDeviceQr(request: Request, response: Response): Promise<void> {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  const device = await getDeviceStatus(request.tenant!.id, deviceKey);
  const data = {
    device_key: device.device_key,
    status: device.status,
    qr_code: device.qr_code ?? null,
    has_qr: Boolean(device.qr_code),
  };
  response.json({
    success: true,
    data,
    ...data,
  });
}

router.get('/devices/:deviceKey/qr', validate({ params: deviceParams }), getDeviceQr);

router.post('/devices/:deviceKey/pause', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  response.json({ success: true, data: await pauseDevice(request.tenant!.id, deviceKey) });
});

router.post('/devices/:deviceKey/resume', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  response.json({ success: true, data: await resumeDevice(request.tenant!.id, deviceKey) });
});

export async function deleteDevice(request: Request, response: Response): Promise<void> {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  const device = await pool.query(
    'SELECT id FROM devices WHERE device_key = $1 AND tenant_id = $2 LIMIT 1',
    [deviceKey, request.tenant!.id],
  );
  if (!device.rows[0]) {
    response.status(404).json({
      success: false,
      error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found' },
    });
    return;
  }
  const managerResponse = await fetch(
    `${config.deviceManager.url}/devices/${encodeURIComponent(deviceKey)}`,
    { method: 'DELETE', headers: { 'x-admin-key': config.adminApiKey } },
  );
  if (!managerResponse.ok) {
    const result = await managerResponse.json() as { error?: { code?: unknown; message?: unknown } };
    response.status(managerResponse.status).json({
      success: false,
      error: {
        code: typeof result.error?.code === 'string' ? result.error.code : 'DEVICE_MANAGER_ERROR',
        message: typeof result.error?.message === 'string' ? result.error.message : 'Device Manager request failed',
      },
    });
    return;
  }
  response.json({ success: true, data: null });
}

export async function reconnectDevice(request: Request, response: Response): Promise<void> {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  const device = await pool.query<{ id: string; status: string }>(
    'SELECT id, status FROM devices WHERE device_key = $1 AND tenant_id = $2 LIMIT 1',
    [deviceKey, request.tenant!.id],
  );
  if (!device.rows[0]) {
    response.status(404).json({ success: false, error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found' } });
    return;
  }
  if (device.rows[0].status !== 'offline' && device.rows[0].status !== 'error') {
    response.status(409).json({ success: false, error: { code: 'DEVICE_NOT_RECOVERABLE', message: 'Device hanya bisa dipulihkan saat offline atau error.' } });
    return;
  }

  const managerResponse = await fetch(
    `${config.deviceManager.url}/devices/${encodeURIComponent(deviceKey)}/reconnect`,
    { method: 'POST', headers: { 'x-admin-key': config.adminApiKey } },
  );
  const result = await managerResponse.json() as Record<string, unknown>;
  if (!managerResponse.ok) {
    const upstreamError = result.error as { code?: unknown; message?: unknown } | undefined;
    response.status(managerResponse.status).json({
      success: false,
      error: {
        code: typeof upstreamError?.code === 'string' ? upstreamError.code : 'DEVICE_MANAGER_ERROR',
        message: typeof upstreamError?.message === 'string' ? upstreamError.message : 'Device Manager request failed',
      },
    });
    return;
  }
  response.json({ success: true, data: { device_key: deviceKey, status: 'starting' } });
}

router.delete('/devices/:deviceKey', validate({ params: deviceParams }), deleteDevice);
router.post('/devices/:deviceKey/reconnect', validate({ params: deviceParams }), reconnectDevice);

export default router;
