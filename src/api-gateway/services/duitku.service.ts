import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '../../shared/database/connection';
import config from '../../shared/config';
import { ServiceError } from './service-error';
import { computeDuitkuRequestSignature, verifyDuitkuCallbackSignature } from './duitku-signature';
import { creditWalletWithClient } from './wallet.service';

const CREATE_INVOICE_PATH = '/api/merchant/createInvoice';
const CALLBACK_PATH = '/billing/duitku/notify';

interface CreateInvoiceResponse {
  merchantCode?: string;
  reference?: string;
  paymentUrl?: string;
  statusCode?: string;
}

export async function createDuitkuCheckout(
  invoiceNumber: string,
  amountIdr: number,
  customer: { id: string; name: string; email: string | null },
): Promise<{ payment_url: string; reference: string }> {
  if (!config.duitku.configured) {
    throw new ServiceError(503, 'DUITKU_NOT_CONFIGURED', 'Pembayaran Duitku sandbox belum dikonfigurasi di server ini.');
  }
  if (!config.appPublicUrl) {
    throw new ServiceError(503, 'APP_PUBLIC_URL_NOT_CONFIGURED', 'APP_PUBLIC_URL belum diatur untuk callback Duitku.');
  }
  if (!customer.email) throw new ServiceError(422, 'CUSTOMER_EMAIL_REQUIRED', 'Email workspace wajib tersedia untuk membuat checkout Duitku.');

  const timestamp = String(Date.now());
  const merchantCode = config.duitku.merchantCode!;
  const body = {
    paymentAmount: amountIdr,
    merchantOrderId: invoiceNumber,
    productDetails: 'Saldo PAYG KONEVA',
    email: customer.email,
    customerVaName: customer.name.slice(0, 20) || 'KONEVA',
    callbackUrl: `${config.appPublicUrl}${CALLBACK_PATH}`,
    returnUrl: `${config.appPublicUrl}/billing?duitku=return`,
    expiryPeriod: 60,
  };

  let response: globalThis.Response;
  try {
    response = await fetch(`${config.duitku.baseUrl}${CREATE_INVOICE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-duitku-timestamp': timestamp,
        'x-duitku-signature': computeDuitkuRequestSignature(merchantCode, timestamp, config.duitku.apiKey!),
        'x-duitku-merchantcode': merchantCode,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ServiceError(502, 'DUITKU_CHECKOUT_FAILED', 'Tidak dapat menghubungi Duitku sandbox. Coba lagi beberapa saat.');
  }

  const json = await response.json().catch(() => null) as CreateInvoiceResponse | null;
  let paymentUrl: URL | null = null;
  try { paymentUrl = json?.paymentUrl ? new URL(json.paymentUrl) : null; } catch { /* invalid provider response */ }
  if (!response.ok || json?.statusCode !== '00' || !json.reference || !paymentUrl || paymentUrl.protocol !== 'https:' || paymentUrl.hostname !== 'app-sandbox.duitku.com') {
    throw new ServiceError(502, 'DUITKU_CHECKOUT_FAILED', 'Duitku sandbox menolak permintaan checkout.');
  }
  return { payment_url: paymentUrl.toString(), reference: json.reference };
}

export interface DuitkuCallback {
  merchantCode?: string;
  amount?: string;
  merchantOrderId?: string;
  resultCode?: string;
  reference?: string;
  signature?: string;
}

export interface DuitkuCallbackResult { applied: boolean; reason: string }

export async function handleDuitkuCallback(fields: DuitkuCallback): Promise<DuitkuCallbackResult> {
  if (!config.duitku.configured) throw new ServiceError(503, 'DUITKU_NOT_CONFIGURED', 'Duitku belum dikonfigurasi.');
  const { merchantCode, amount, merchantOrderId, resultCode, reference, signature } = fields;
  if ([merchantCode, amount, merchantOrderId, resultCode, signature].some((value) => typeof value !== 'string' || !value)
    || (reference !== undefined && typeof reference !== 'string')
    || !/^\d+$/.test(amount!) || !/^TOP-[A-Z0-9-]{1,60}$/.test(merchantOrderId!)) {
    throw new ServiceError(400, 'INVALID_CALLBACK', 'Parameter callback Duitku tidak lengkap atau tidak valid.');
  }
  if (merchantCode !== config.duitku.merchantCode || !verifyDuitkuCallbackSignature(merchantCode!, amount!, merchantOrderId!, config.duitku.apiKey!, signature!)) {
    throw new ServiceError(401, 'INVALID_SIGNATURE', 'Signature callback Duitku tidak valid.');
  }
  const amountIdr = Number(amount);
  if (!Number.isSafeInteger(amountIdr)) throw new ServiceError(400, 'INVALID_CALLBACK_AMOUNT', 'Nominal callback Duitku tidak valid.');
  const eventKey = createHash('sha256').update([merchantOrderId, amount, resultCode, reference ?? ''].join('\n')).digest('hex');

  return transaction(async (client: PoolClient) => {
    const inserted = await client.query<{ event_key: string }>(
      `INSERT INTO duitku_callback_events(event_key,merchant_order_id,amount_idr,result_code,provider_reference)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING RETURNING event_key`,
      [eventKey, merchantOrderId, amountIdr, resultCode, reference ?? null],
    );
    if (!inserted.rowCount) return { applied: false, reason: 'replay' };

    const topup = (await client.query<{ tenant_id: string; amount_idr: number | string; status: string; payment_provider: string }>(
      'SELECT tenant_id,amount_idr,status,payment_provider FROM wallet_topups WHERE invoice_number=$1 FOR UPDATE', [merchantOrderId],
    )).rows[0];
    let applied = false;
    let reason: string;
    if (!topup) reason = 'invoice_not_found';
    else if (topup.payment_provider !== 'duitku') reason = 'wrong_provider';
    else if (topup.status !== 'unpaid') reason = topup.status === 'paid' ? 'already_paid' : 'topup_void';
    else if (Number(topup.amount_idr) !== amountIdr) reason = 'amount_mismatch';
    else if (resultCode !== '00') reason = `status_${resultCode}`;
    else {
      const paid = await client.query(
        `UPDATE wallet_topups SET status='paid',paid_at=now(),payment_reference=$2
         WHERE invoice_number=$1 AND payment_provider='duitku' AND status='unpaid' RETURNING tenant_id`,
        [merchantOrderId, reference ?? null],
      );
      if (!paid.rowCount) reason = 'already_paid';
      else {
        await creditWalletWithClient(client, topup!.tenant_id, amountIdr, `wallet-topup:${merchantOrderId}`, merchantOrderId!);
        applied = true;
        reason = 'wallet_topped_up';
      }
    }
    await client.query('UPDATE duitku_callback_events SET applied_at=CASE WHEN $2 THEN now() ELSE applied_at END, result_reason=$3 WHERE event_key=$1', [eventKey, applied, reason]);
    return { applied, reason };
  });
}
