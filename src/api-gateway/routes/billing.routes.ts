import { requireVerifiedEmail } from '../middleware/verified-email';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../../shared/config';
import { validate } from '../middleware/validate';
import { createOrder, getBillingState, getLatestUnpaidInvoice, requestStudentVerification } from '../services/billing.service';
import { createDokuCheckout } from '../services/doku.service';
import { ServiceError } from '../services/service-error';
import { createWalletTopup } from '../services/wallet.service';

const router = Router();

export const orderSchema = z.object({
  plan: z.string().min(1).max(20),
  cycle: z.enum(['monthly', 'yearly']),
}).strict();

export const studentSchema = z.object({ note: z.string().trim().max(500).default('') }).strict();
export const walletTopupSchema = z.object({ amount_idr: z.number().int().min(10000).max(10_000_000) }).strict();

router.get('/billing', async (request: Request, response: Response) => {
  const state = await getBillingState(request.tenant!.id);
  response.json({
    success: true,
    data: { ...state, payment: { instructions: config.billing.paymentInstructions, contact: config.billing.operatorContact } },
  });
});

router.post('/billing/orders', requireVerifiedEmail, validate({ body: orderSchema }), async (request: Request, response: Response) => {
  const body = request.validated!.body as z.infer<typeof orderSchema>;
  const invoice = await createOrder(request.tenant!.id, body.plan, body.cycle);
  response.status(201).json({
    success: true, data: invoice,
    payment: { instructions: config.billing.paymentInstructions, contact: config.billing.operatorContact },
    notice: 'Setelah membayar, kirim bukti pembayaran ke penyedia layanan. Paket aktif setelah pembayaran dikonfirmasi.',
  });
});

router.post('/billing/doku/checkout', requireVerifiedEmail, async (request: Request, response: Response) => {
  const invoice = await getLatestUnpaidInvoice(request.tenant!.id);
  if (!invoice) throw new ServiceError(404, 'NO_UNPAID_INVOICE', 'Belum ada invoice yang belum dibayar. Buat pesanan dulu lewat POST /billing/orders.');
  const checkout = await createDokuCheckout(invoice.number, invoice.amount_idr, {
    id: request.tenant!.id,
    name: request.tenant!.name,
    email: request.tenant!.email,
  });
  response.json({ success: true, data: { invoice_number: invoice.number, payment_url: checkout.payment_url } });
});

router.post('/billing/payg/topup-checkout', requireVerifiedEmail, validate({ body: walletTopupSchema }), async (request: Request, response: Response) => {
  const { amount_idr } = request.validated!.body as z.infer<typeof walletTopupSchema>;
  if (!config.doku.configured) throw new ServiceError(503, 'DOKU_NOT_CONFIGURED', 'Pembayaran DOKU belum dikonfigurasi di server ini.');
  if (!config.appPublicUrl) throw new ServiceError(503, 'APP_PUBLIC_URL_NOT_CONFIGURED', 'APP_PUBLIC_URL belum diatur untuk callback DOKU.');
  const topup = await createWalletTopup(request.tenant!.id, amount_idr);
  const checkout = await createDokuCheckout(topup.invoice_number, topup.amount_idr, topup.customer);
  response.status(201).json({ success: true, data: { invoice_number: topup.invoice_number, amount_idr: topup.amount_idr, payment_url: checkout.payment_url } });
});

router.post('/billing/student-request', validate({ body: studentSchema }), async (request: Request, response: Response) => {
  const actor = request.actor;
  if (!actor || actor.kind !== 'user') throw new ServiceError(403, 'FORBIDDEN', 'Verifikasi pelajar diajukan oleh pemilik yang sedang masuk.');
  await requestStudentVerification(request.tenant!.id, actor.email, (request.validated!.body as z.infer<typeof studentSchema>).note);
  response.json({ success: true, message: 'Permintaan verifikasi dikirim. Penyedia layanan akan memeriksanya.' });
});

export default router;
