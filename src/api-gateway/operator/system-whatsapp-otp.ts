import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import config from '../../shared/config';
import { queueSystemNotification } from '../services/message.service';
import { OperatorError, lockActor, operatorTransaction, writeAudit, type Actor } from './core';

interface SenderRow {
  tenant_id: string;
  device_key: string | null;
  updated_at: Date;
  id: string | null;
  status: string | null;
  phone_number: string | null;
  qr_code: string | null;
  notification_recipient_phone: string | null;
  notifications_enabled: boolean;
  notification_test_queued_at: Date | null;
}

interface SignupOtpActivityRow {
  id: string;
  phone_last4: string | null;
  created_at: Date;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
  send_status: string;
  send_error_code: string | null;
  message_status: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  phone_verified_at: Date | null;
  message_error: string | null;
}

async function senderRow(db: Pick<PoolClient, 'query'> | Pool, lock = false): Promise<SenderRow> {
  const result = await db.query<SenderRow>(
    `SELECT s.tenant_id, s.device_key, s.updated_at, d.id, d.status, d.phone_number, d.qr_code,
       s.notification_recipient_phone,s.notifications_enabled,s.notification_test_queued_at
     FROM system_whatsapp_otp_sender s
     JOIN tenants t ON t.id=s.tenant_id AND t.is_system=true
     LEFT JOIN devices d ON d.device_key=s.device_key AND d.tenant_id=s.tenant_id
     WHERE s.singleton=true ${lock ? 'FOR UPDATE OF s' : ''}`,
  );
  if (!result.rows[0]) throw new OperatorError(503, 'OTP_SENDER_NOT_INITIALIZED', 'Pengirim OTP belum disiapkan. Jalankan migrasi terbaru.');
  return result.rows[0];
}

function publicSender(row: SenderRow, qr = false) {
  return {
    configured: Boolean(row.device_key),
    device_key: row.device_key,
    status: row.status ?? 'not_configured',
    phone_last4: row.phone_number ? row.phone_number.slice(-4) : null,
    updated_at: row.updated_at,
    notifications_enabled: row.notifications_enabled,
    notification_recipient_last4: row.notification_recipient_phone?.slice(-4) ?? null,
    notification_test_queued_at: row.notification_test_queued_at,
    ...(qr && row.status === 'pending_qr' && row.qr_code ? { qr_code: row.qr_code } : {}),
  };
}

async function recentSignupOtpActivity(db: Pick<PoolClient, 'query'> | Pool) {
  const { rows } = await db.query<SignupOtpActivityRow>(
    `SELECT v.id,v.phone_last4,v.created_at,v.expires_at,v.attempts,v.consumed_at,u.phone_verified_at,
       v.send_status,v.send_error_code,m.status AS message_status,m.sent_at,m.delivered_at,m.read_at,
       CASE WHEN m.error_message IN ('otp_expired','not_connected','device_paused','device_banned',
         'device_suspended','QUEUE_UNAVAILABLE','recipient_opted_out','recipient_consent_required')
         THEN m.error_message ELSE NULL END AS message_error
     FROM signup_phone_verifications v
     JOIN users u ON u.id=v.user_id
     LEFT JOIN messages m ON m.system_otp=true AND
       (m.id=v.message_id OR (v.message_id IS NULL AND m.external_id='signup_otp_' || v.id::text))
     ORDER BY v.created_at DESC LIMIT 10`,
  );
  return rows.map((row) => ({
    id: row.id,
    phone_last4: row.phone_last4,
    created_at: row.created_at,
    expires_at: row.expires_at,
    attempts: Number(row.attempts),
    verification_status: row.phone_verified_at && row.phone_verified_at >= row.created_at
      ? 'used' : row.consumed_at ? 'invalidated'
        : new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : 'pending',
    message_status: row.message_status ?? row.send_status,
    error_code: row.message_error ?? row.send_error_code,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
  }));
}

function normalizeOperatorPhone(value: string): string {
  let digits = value.replace(/[^0-9]/g, '');
  if (digits.startsWith('0062')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  if (!/^62[0-9]{8,13}$/.test(digits)) throw new OperatorError(400, 'INVALID_PHONE_NUMBER', 'Masukkan nomor WhatsApp Indonesia yang valid.');
  return digits;
}

export async function saveSystemWhatsappNotificationSettings(db: Pool, actor: Actor, requestId: string, clientIp: string,
  input: { recipientPhone?: string | null; enabled: boolean }) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    const row = await senderRow(client, true);
    const phone = input.recipientPhone === undefined ? row.notification_recipient_phone
      : input.recipientPhone ? normalizeOperatorPhone(input.recipientPhone) : null;
    if (input.enabled && !phone) throw new OperatorError(400, 'NOTIFICATION_RECIPIENT_REQUIRED', 'Nomor operator wajib diisi untuk mengaktifkan notifikasi.');
    if (input.enabled && (phone !== row.notification_recipient_phone || !row.notification_test_queued_at)) {
      throw new OperatorError(409, 'NOTIFICATION_TEST_REQUIRED', 'Kirim dan pastikan pesan uji diterima sebelum mengaktifkan notifikasi.');
    }
    await client.query(
      `UPDATE system_whatsapp_otp_sender SET notification_recipient_phone=$1::varchar,notifications_enabled=$2,
         notification_test_queued_at=CASE WHEN $1::varchar IS DISTINCT FROM notification_recipient_phone THEN NULL ELSE notification_test_queued_at END,
         updated_at=now(),updated_by=$3 WHERE singleton=true`, [phone, input.enabled, actor.id],
    );
    await writeAudit(client, actor, 'system_notifications.settings_update', 'system_whatsapp_otp_sender', row.tenant_id,
      'Penerima notifikasi sistem WhatsApp', {
        recipient_last4: { from: row.notification_recipient_phone?.slice(-4) ?? null, to: phone?.slice(-4) ?? null },
        enabled: { from: row.notifications_enabled, to: input.enabled },
      }, requestId, clientIp);
    return { notifications_enabled: input.enabled, recipient_last4: phone?.slice(-4) ?? null };
  });
}

export async function queueSystemWhatsappNotificationTest(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  const target = await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    const row = await senderRow(client, true);
    if (!row.notification_recipient_phone) throw new OperatorError(409, 'NOTIFICATION_RECIPIENT_REQUIRED', 'Simpan nomor operator terlebih dahulu.');
    if (!row.device_key || row.status !== 'online') throw new OperatorError(503, 'OTP_SENDER_OFFLINE', 'Pengirim WhatsApp belum online.');
    await writeAudit(client, actor, 'system_notifications.test_queued', 'system_whatsapp_otp_sender', row.tenant_id,
      'Uji notifikasi WhatsApp sistem', { recipient_last4: { from: null, to: row.notification_recipient_phone.slice(-4) } }, requestId, clientIp);
    return { tenantId: row.tenant_id, deviceKey: row.device_key, recipient: row.notification_recipient_phone, tenant: row.tenant_id };
  });
  const message = await queueSystemNotification(target.tenantId, randomUUID(), {
    device_key: target.deviceKey, to: target.recipient, message: 'Uji notifikasi sistem KONEVA berhasil masuk ke antrean.',
  });
  await db.query('UPDATE system_whatsapp_otp_sender SET notification_test_queued_at=now() WHERE singleton=true');
  return { queued: message.status === 'queued', status: message.status, recipient_last4: target.recipient.slice(-4) };
}

export async function getSystemWhatsappOtpSender(db: Pool, actor: Actor, requestId: string, clientIp: string, includeQr = false) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    const row = await senderRow(client, includeQr);
    const recentOtps = await recentSignupOtpActivity(client);
    if (includeQr) {
      await writeAudit(client, actor, 'system_otp_sender.qr_view', 'system_whatsapp_otp_sender', row.tenant_id,
        'Pengirim OTP WhatsApp KONEVA', {}, requestId, clientIp);
    }
    return { ...publicSender(row, includeQr), recent_otps: recentOtps };
  });
}

export async function pairSystemWhatsappOtpSender(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    const row = await senderRow(client, true);
    if (row.device_key) return publicSender(row);

    // Recover a provisioned device if a previous HTTP response was lost after Device Manager committed it.
    const orphan = (await client.query<{ device_key: string; status: string }>(
      `SELECT device_key,status FROM devices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [row.tenant_id],
    )).rows[0];
    if (orphan && orphan.status !== 'error') {
      await client.query(`UPDATE system_whatsapp_otp_sender SET device_key=$1, updated_at=now(), updated_by=$2 WHERE singleton=true`, [orphan.device_key, actor.id]);
      await writeAudit(client, actor, 'system_otp_sender.recovered', 'system_whatsapp_otp_sender', row.tenant_id,
        'Pengirim OTP WhatsApp KONEVA', { status: { from: 'not_configured', to: orphan.status } }, requestId, clientIp);
      return { configured: true, device_key: orphan.device_key, status: orphan.status, phone_last4: null, updated_at: new Date() };
    }
    if (orphan?.status === 'error') {
      let cleanup: Response;
      try {
        cleanup = await fetch(`${config.deviceManager.url}/devices/${encodeURIComponent(orphan.device_key)}`, {
          method: 'DELETE', headers: { 'x-admin-key': config.adminApiKey }, signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new OperatorError(502, 'OTP_SENDER_CLEANUP_FAILED', 'Device pengirim yang gagal belum dapat dibersihkan. Coba lagi.');
      }
      if (!cleanup.ok) throw new OperatorError(502, 'OTP_SENDER_CLEANUP_FAILED', 'Device pengirim yang gagal belum dapat dibersihkan. Coba lagi.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(`${config.deviceManager.url}/devices`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-admin-key': config.adminApiKey },
        body: JSON.stringify({ tenant_id: row.tenant_id, label: 'KONEVA OTP Sender' }),
      });
    } catch {
      throw new OperatorError(502, 'OTP_SENDER_PROVISION_FAILED', 'Gagal menghubungi pengelola device. Coba lagi.');
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      throw new OperatorError(502, 'OTP_SENDER_PROVISION_FAILED', 'Device pengirim belum dapat dibuat. Periksa layanan device lalu coba lagi.');
    }
    const payload = await response.json().catch(() => null) as { device_key?: unknown } | null;
    if (typeof payload?.device_key !== 'string' || !/^WAPI-[A-Z0-9-]{1,60}$/i.test(payload.device_key)) {
      throw new OperatorError(502, 'OTP_SENDER_PROVISION_FAILED', 'Pengelola device mengembalikan respons yang tidak valid.');
    }
    const updated = await client.query(
      `UPDATE system_whatsapp_otp_sender SET device_key=$1, updated_at=now(), updated_by=$2
       WHERE singleton=true AND device_key IS NULL`, [payload.device_key, actor.id],
    );
    if (!updated.rowCount) throw new OperatorError(409, 'OTP_SENDER_ALREADY_CONFIGURED', 'Device pengirim sudah dikonfigurasi. Muat ulang halaman.');
    await writeAudit(client, actor, 'system_otp_sender.pair', 'system_whatsapp_otp_sender', row.tenant_id,
      'Pengirim OTP WhatsApp KONEVA', { status: { from: 'not_configured', to: 'pending_qr' } }, requestId, clientIp);
    return { configured: true, device_key: payload.device_key, status: 'pending_qr', phone_last4: null, updated_at: new Date() };
  });
}
