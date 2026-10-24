import express, { Router, type Request, type Response } from 'express';
import { handleDuitkuCallback } from '../services/duitku.service';
import { ServiceError } from '../services/service-error';

const router = Router();
const formBody = express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 40 });

/** Public payment callback; authenticity is checked using Duitku's HMAC signature in the service. */
router.post('/billing/duitku/notify', formBody, async (request: Request, response: Response) => {
  if (!request.is('application/x-www-form-urlencoded')) {
    throw new ServiceError(415, 'UNSUPPORTED_CALLBACK_CONTENT_TYPE', 'Callback Duitku harus berupa form URL-encoded.');
  }
  await handleDuitkuCallback(request.body);
  response.status(200).type('text/plain').send('OK');
});

export default router;
