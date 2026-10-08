import { Router, type Request, type Response } from 'express';
import { handleDokuNotification } from '../services/doku.service';
import { ServiceError } from '../services/service-error';

const router = Router();

/**
 * Inbound DOKU payment notification. Public (DOKU calls this directly — it has no KONEVA apikey),
 * authenticated instead by DOKU's own HMAC Signature header, verified in doku.service.ts over the
 * exact raw bytes (req.rawBody, captured by express.json()'s `verify` hook in index.ts).
 * Always 200 once durably recorded (including a replay or a non-SUCCESS status) so DOKU does not retry
 * a notification we've already stored — matching docs/API.md's existing webhook delivery convention.
 */
router.post('/billing/doku/notify', async (request: Request, response: Response) => {
  if (!request.rawBody) throw new ServiceError(400, 'MISSING_BODY', 'Request body kosong.');
  const clientId = request.get('Client-Id');
  const requestId = request.get('Request-Id');
  const requestTimestamp = request.get('Request-Timestamp');
  const signature = request.get('Signature');
  if (!clientId || !requestId || !requestTimestamp || !signature) {
    throw new ServiceError(400, 'MISSING_HEADERS', 'Header Client-Id/Request-Id/Request-Timestamp/Signature wajib ada.');
  }

  const result = await handleDokuNotification(
    request.rawBody.toString('utf8'),
    { clientId, requestId, requestTimestamp, signature },
    '/billing/doku/notify',
  );
  response.status(200).json({ success: true, applied: result.applied, reason: result.reason });
});

export default router;
