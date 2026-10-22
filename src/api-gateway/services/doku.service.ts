import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from '../../shared/database/connection';
import config from '../../shared/config';
import { ServiceError } from './service-error';
import { computeDokuSignature, verifyDokuSignature } from './doku-signature';
import { markInvoicePaidWithClient } from './billing.service';
import { creditWalletWithClient } from './wallet.service';

/**
 * DOKU Non-SNAP checkout + inbound notification handling, per docs/DOKU_INTEGRATION_SPEC.md.
 * Sandbox base URL only (config.doku.baseUrl) — switching to production DOKU is a deliberate
 * code change later, never an env toggle, so this can't silently go live.
 */

/**
 * How old a validly-signed Request-Timestamp may be before a notification is rejected as stale.
 * NOT a DOKU-documented limit — checked developers.doku.com, jokul.doku.com (signature pages,
 * notification setup, HTTP Notification Best Practice) on 2026-10-04 and none of them specify a
 * tolerance window. This is this project's own conservative choice (same order of magnitude as
 * other HMAC-webhook providers' defaults), pending confirmation from DOKU support. A bad signature
 * is rejected regardless of this check (the signature itself covers Request-Timestamp, so tampering
 * with it already fails verification) — this check instead stops a valid-at-the-time notification
 * from being replayed much later.
 */
const REQUEST_TIMESTAMP_MAX_AGE_MS = 5 * 60 * 1000;

interface DokuCheckoutResponse {
  response?: { payment?: { url?: string; token_id?: string } };
}

export async function createDokuCheckout(
  invoiceNumber: string,
  amountIdr: number,
  customer: { id: string; name: string; email: string | null },
): Promise<{ payment_url: string; token_id: string | undefined }> {
  if (!config.doku.configured) {
    throw new ServiceError(503, 'DOKU_NOT_CONFIGURED', 'Pembayaran DOKU belum dikonfigurasi di server ini.');
  }
  if (!config.appPublicUrl) {
    throw new ServiceError(503, 'APP_PUBLIC_URL_NOT_CONFIGURED', 'APP_PUBLIC_URL belum diatur; tidak bisa membuat callback URL DOKU.');
  }

  const requestId = randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const requestTarget = '/checkout/v1/payment';
  const body = {
    order: {
      amount: amountIdr,
      invoice_number: invoiceNumber,
      currency: 'IDR',
      callback_url: `${config.appPublicUrl}/billing?doku=success`,
      callback_url_cancel: `${config.appPublicUrl}/billing?doku=cancel`,
      callback_url_result: `${config.appPublicUrl}/billing?doku=result`,
      // Required by DOKU's Checkout API (developers.doku.com, backend-integration guide, checked 2026-10-07):
      // true -> redirect to callback_url after payment; false -> DOKU's own payment-result page.
      auto_redirect: true,
    },
    payment: { payment_due_date: 60 },
    customer: { id: customer.id, name: customer.name, ...(customer.email ? { email: customer.email } : {}) },
  };
  const rawBody = JSON.stringify(body);
  const signature = computeDokuSignature(
    { clientId: config.doku.clientId!, requestId, requestTimestamp, requestTarget, rawBody },
    config.doku.sharedKey!,
  );

  const response = await fetch(`${config.doku.baseUrl}${requestTarget}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': config.doku.clientId!,
      'Request-Id': requestId,
      'Request-Timestamp': requestTimestamp,
      Signature: signature,
    },
    body: rawBody,
  });
  const json = (await response.json().catch(() => null)) as DokuCheckoutResponse | null;
  const paymentUrl = json?.response?.payment?.url;
  if (!response.ok || !paymentUrl) {
    throw new ServiceError(502, 'DOKU_CHECKOUT_FAILED', 'DOKU menolak permintaan checkout sandbox.');
  }
  return { payment_url: paymentUrl, token_id: json?.response?.payment?.token_id };
}

export interface DokuNotificationHeaders {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  signature: string;
}

export interface DokuNotificationResult {
  applied: boolean;
  reason:
    | 'activated'
    | 'replay'
    | 'already_paid'
    | 'invoice_not_found'
    | 'amount_mismatch'
    | 'currency_mismatch'
    | 'wallet_topped_up'
    | `status_${string}`;
}

function parseTimestampMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new ServiceError(400, 'INVALID_TIMESTAMP', 'Request-Timestamp bukan tanggal ISO 8601 yang valid.');
  return ms;
}

/**
 * Verifies signature -> rejects a stale Request-Timestamp -> everything else (idempotency record,
 * amount/currency cross-check, invoice confirmation, workspace activation) runs inside ONE database
 * transaction. This is deliberate: if activation throws for any reason, the whole transaction rolls
 * back, INCLUDING the idempotency row — so a retry with the same Request-Id starts completely fresh
 * and actually retries activation, instead of being told "already handled" (reason: 'replay') while
 * the invoice is still unpaid. markInvoicePaidWithClient's own 'unpaid'-only guard is a second,
 * independent safety net against double-activation from a *different* Request-Id.
 */
export async function handleDokuNotification(
  rawBody: string,
  headers: DokuNotificationHeaders,
  requestTarget: string,
): Promise<DokuNotificationResult> {
  if (!config.doku.configured) throw new ServiceError(503, 'DOKU_NOT_CONFIGURED', 'DOKU belum dikonfigurasi.');

  const signatureOk = verifyDokuSignature(
    { clientId: headers.clientId, requestId: headers.requestId, requestTimestamp: headers.requestTimestamp, requestTarget, rawBody },
    config.doku.sharedKey!,
    headers.signature,
  );
  if (!signatureOk) throw new ServiceError(401, 'INVALID_SIGNATURE', 'Signature DOKU tidak valid.');
  if (headers.clientId !== config.doku.clientId) throw new ServiceError(401, 'INVALID_CLIENT_ID', 'Client-Id tidak cocok.');

  const timestampMs = parseTimestampMs(headers.requestTimestamp);
  if (Math.abs(Date.now() - timestampMs) > REQUEST_TIMESTAMP_MAX_AGE_MS) {
    throw new ServiceError(401, 'STALE_TIMESTAMP', `Request-Timestamp lebih dari ${REQUEST_TIMESTAMP_MAX_AGE_MS / 60_000} menit dari sekarang.`);
  }

  let payload: { order?: { invoice_number?: string; amount?: number; currency?: string }; transaction?: { status?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ServiceError(400, 'INVALID_BODY', 'Body notifikasi bukan JSON valid.');
  }
  const invoiceNumber = payload.order?.invoice_number;
  const status = payload.transaction?.status;
  if (!invoiceNumber || !status) throw new ServiceError(400, 'INVALID_BODY', 'order.invoice_number / transaction.status tidak ada.');

  return transaction(async (client: PoolClient) => {
    const existing = (await client.query<{ status: string; applied_at: Date | null }>(
      'SELECT status, applied_at FROM doku_notification_events WHERE request_id = $1 FOR UPDATE',
      [headers.requestId],
    )).rows[0];

    if (existing) {
      if (existing.applied_at) return { applied: false, reason: 'replay' } as const;
      // A row with no applied_at and a non-SUCCESS status was fully recorded and is correctly final
      // (nothing to retry — a PENDING/FAILED/etc. notification never activates anything). Only a
      // row whose recorded status was 'SUCCESS' but applied_at is still null falls through to retry
      // activation below; under this atomic design that should not normally occur (a SUCCESS row is
      // only ever committed together with applied_at set), but is handled defensively in case an
      // older, pre-fix row exists.
      if (existing.status !== 'SUCCESS') return { applied: false, reason: `status_${existing.status}` } as const;
    } else {
      await client.query(
        'INSERT INTO doku_notification_events (request_id, invoice_number, status) VALUES ($1, $2, $3)',
        [headers.requestId, invoiceNumber, status],
      );
    }

    if (status !== 'SUCCESS') return { applied: false, reason: `status_${status}` } as const;

    const topup = (await client.query<{ tenant_id: string; amount_idr: number; status: string }>(
      'SELECT tenant_id,amount_idr,status FROM wallet_topups WHERE invoice_number=$1 FOR UPDATE', [invoiceNumber],
    )).rows[0];
    if (topup) {
      const notifiedCurrency = payload.order?.currency;
      if (notifiedCurrency !== 'IDR') return { applied: false, reason: 'currency_mismatch' } as const;
      if (payload.order?.amount !== Number(topup.amount_idr)) return { applied: false, reason: 'amount_mismatch' } as const;
      const paid = await client.query(
        `UPDATE wallet_topups SET status='paid',paid_at=now(),payment_reference=$2
         WHERE invoice_number=$1 AND status='unpaid' RETURNING tenant_id`, [invoiceNumber, headers.requestId],
      );
      if (!paid.rowCount) return { applied: false, reason: 'already_paid' } as const;
      await creditWalletWithClient(client, topup.tenant_id, Number(topup.amount_idr), `wallet-topup:${invoiceNumber}`, invoiceNumber);
      await client.query('UPDATE doku_notification_events SET applied_at=now() WHERE request_id=$1', [headers.requestId]);
      return { applied: true, reason: 'wallet_topped_up' } as const;
    }

    const invoice = (await client.query<{ id: string; amount_idr: number }>(
      'SELECT id, amount_idr FROM invoices WHERE number = $1',
      [invoiceNumber],
    )).rows[0];
    if (!invoice) return { applied: false, reason: 'invoice_not_found' } as const;

    // Cross-check the notification's own order details against what we actually invoiced, before
    // activating anything. A forged or corrupted notification that merely reuses a real invoice_number
    // must never activate a workspace for the wrong amount.
    const notifiedCurrency = payload.order?.currency;
    if (notifiedCurrency !== 'IDR') return { applied: false, reason: 'currency_mismatch' } as const;
    if (payload.order?.amount !== invoice.amount_idr) return { applied: false, reason: 'amount_mismatch' } as const;

    try {
      await markInvoicePaidWithClient(client, invoice.id, { method: 'doku', reference: headers.requestId });
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'INVOICE_NOT_PAYABLE') return { applied: false, reason: 'already_paid' } as const;
      throw err;
    }
    await client.query('UPDATE doku_notification_events SET applied_at = now() WHERE request_id = $1', [headers.requestId]);
    return { applied: true, reason: 'activated' } as const;
  });
}
