import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { getDeviceStatus, listDevices, pauseDevice, resumeDevice } from '../services/device.service';
import { ServiceError } from '../services/message.service';

const router = Router();
const deviceParams = z.object({ deviceKey: z.string().min(1).max(32) });

router.get('/devices', async (request, response) => {
  response.json({ success: true, data: await listDevices(request.tenant!.id) });
});

router.get('/devices/:deviceKey', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  response.json({ success: true, data: await getDeviceStatus(request.tenant!.id, deviceKey) });
});

router.get('/devices/:deviceKey/qr', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  const device = await getDeviceStatus(request.tenant!.id, deviceKey);
  if (device.status !== 'pending_qr' || !device.qr_code) {
    throw new ServiceError(409, 'QR_NOT_AVAILABLE', 'QR code is not currently available');
  }
  response.json({ success: true, qr_code: device.qr_code });
});

router.post('/devices/:deviceKey/pause', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  response.json({ success: true, data: await pauseDevice(request.tenant!.id, deviceKey) });
});

router.post('/devices/:deviceKey/resume', validate({ params: deviceParams }), async (request, response) => {
  const { deviceKey } = request.validated!.params as { deviceKey: string };
  response.json({ success: true, data: await resumeDevice(request.tenant!.id, deviceKey) });
});

export default router;
