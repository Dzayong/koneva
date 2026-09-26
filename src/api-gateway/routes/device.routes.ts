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
  const deviceCount = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM devices WHERE tenant_id = $1',
    [tenant.id],
  );

  if ((deviceCount.rows[0]?.count ?? 0) >= tenant.max_devices) {
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

router.delete('/devices/:deviceKey', validate({ params: deviceParams }), deleteDevice);

export default router;
