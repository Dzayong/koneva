import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../../shared/config';
import { validate } from '../middleware/validate';
import { createOrder, getBillingState, requestStudentVerification } from '../services/billing.service';
import { ServiceError } from '../services/service-error';

const router = Router();

export const orderSchema = z.object({
  plan: z.string().min(1).max(20),
  cycle: z.enum(['monthly', 'yearly']),
}).strict();

export const studentSchema = z.object({ note: z.string().trim().max(500).default('') }).strict();

router.get('/billing', async (request: Request, response: Response) => {
  const state = await getBillingState(request.tenant!.id);
  response.json({
    success: true,
    data: { ...state, payment: { instructions: config.billing.paymentInstructions, contact: config.billing.operatorContact } },
  });
});

router.post('/billing/orders', validate({ body: orderSchema }), async (request: Request, response: Response) => {
  const body = request.validated!.body as z.infer<typeof orderSchema>;
  const invoice = await createOrder(request.tenant!.id, body.plan, body.cycle);
  response.status(201).json({
    success: true, data: invoice,
    payment: { instructions: config.billing.paymentInstructions, contact: config.billing.operatorContact },
    notice: 'Setelah membayar, kirim bukti pembayaran ke penyedia layanan. Paket aktif setelah pembayaran dikonfirmasi.',
  });
});

router.post('/billing/student-request', validate({ body: studentSchema }), async (request: Request, response: Response) => {
  const actor = request.actor;
  if (!actor || actor.kind !== 'user') throw new ServiceError(403, 'FORBIDDEN', 'Verifikasi pelajar diajukan oleh pemilik yang sedang masuk.');
  await requestStudentVerification(request.tenant!.id, actor.email, (request.validated!.body as z.infer<typeof studentSchema>).note);
  response.json({ success: true, message: 'Permintaan verifikasi dikirim. Penyedia layanan akan memeriksanya.' });
});

export default router;
