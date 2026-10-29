import { requireVerifiedEmail } from '../middleware/verified-email';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../../shared/config';
import { validate } from '../middleware/validate';
import { createOrder, getBillingState, getLatestUnpaidInvoice, requestStudentVerification } from '../services/billing.service';
import { createDokuCheckout } from '../services/doku.service';
import { createDuitkuCheckout } from '../services/duitku.service';
import { ServiceError } from '../services/service-error';
import { createWalletTopup, getUsageDeviceKeys, getUsageDeviceSummary, getUsageHistory, getUsageHistoryCsv, reconcileWallet, updateWalletTopupProviderReference, voidWalletTopup } from '../services/wallet.service';

const router = Router();

export const orderSchema = z.object({
  plan: z.string().min(1).max(20),
  cycle: z.enum(['monthly', 'yearly']),
}).strict();

export const studentSchema = z.object({ note: z.string().trim().max(500).default('') }).strict();
export const walletTopupSchema = z.object({ amount_idr: z.number().int().min(10000).max(10_000_000) }).strict();

const usageHistoryQuery = z.object({
  device_key: z.string().min(1).max(32).optional(),
  billing_category: z.enum(['api', 'auto_reply', 'ai_reply']).optional(),
  status: z.enum(['charged', 'refunded', 'pending']).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

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
  if (!config.duitku.configured) throw new ServiceError(503, 'DUITKU_NOT_CONFIGURED', 'Pembayaran Duitku sandbox belum dikonfigurasi di server ini.');
  if (!config.appPublicUrl) throw new ServiceError(503, 'APP_PUBLIC_URL_NOT_CONFIGURED', 'APP_PUBLIC_URL belum diatur untuk callback Duitku.');
  const topup = await createWalletTopup(request.tenant!.id, amount_idr);
  try {
    const checkout = await createDuitkuCheckout(topup.invoice_number, topup.amount_idr, topup.customer);
    await updateWalletTopupProviderReference(topup.invoice_number, checkout.reference);
    response.status(201).json({ success: true, data: { invoice_number: topup.invoice_number, amount_idr: topup.amount_idr, payment_url: checkout.payment_url } });
  } catch (error) {
    await voidWalletTopup(topup.invoice_number);
    throw error;
  }
});

router.get('/billing/usage-history', validate({ query: usageHistoryQuery }), async (request: Request, response: Response) => {
  const q = request.validated!.query as z.infer<typeof usageHistoryQuery>;
  const result = await getUsageHistory({
    tenantId: request.tenant!.id,
    deviceKey: q.device_key,
    billingCategory: q.billing_category,
    status: q.status,
    dateFrom: q.date_from,
    dateTo: q.date_to,
    limit: q.limit,
    offset: q.offset,
  });
  response.json({ success: true, ...result });
});

router.get('/billing/usage-history/csv', validate({ query: usageHistoryQuery }), async (request: Request, response: Response) => {
  const q = request.validated!.query as z.infer<typeof usageHistoryQuery>;
  const csv = await getUsageHistoryCsv({
    tenantId: request.tenant!.id,
    deviceKey: q.device_key,
    billingCategory: q.billing_category,
    status: q.status,
    dateFrom: q.date_from,
    dateTo: q.date_to,
  });
  const filename = `riwayat-penggunaan-${new Date().toISOString().slice(0, 10)}.csv`;
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.send('﻿' + csv);
});

router.get('/billing/usage-history/devices', async (request: Request, response: Response) => {
  const devices = await getUsageDeviceKeys(request.tenant!.id);
  response.json({ success: true, data: devices });
});

const deviceSummaryQuery = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

router.get('/billing/usage-history/device-summary', validate({ query: deviceSummaryQuery }), async (request: Request, response: Response) => {
  const q = request.validated!.query as z.infer<typeof deviceSummaryQuery>;
  const summary = await getUsageDeviceSummary(request.tenant!.id, q.date_from, q.date_to);
  response.json({ success: true, data: summary });
});

router.get('/billing/reconcile', async (request: Request, response: Response) => {
  const result = await reconcileWallet(request.tenant!.id);
  response.json({ success: true, data: result });
});

router.post('/billing/student-request', validate({ body: studentSchema }), async (request: Request, response: Response) => {
  const actor = request.actor;
  if (!actor || actor.kind !== 'user') throw new ServiceError(403, 'FORBIDDEN', 'Verifikasi pelajar diajukan oleh pemilik yang sedang masuk.');
  await requestStudentVerification(request.tenant!.id, actor.email, (request.validated!.body as z.infer<typeof studentSchema>).note);
  response.json({ success: true, message: 'Permintaan verifikasi dikirim. Penyedia layanan akan memeriksanya.' });
});

export default router;
