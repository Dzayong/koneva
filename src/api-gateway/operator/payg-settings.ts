import type { Pool } from 'pg';
import { lockActor, operatorTransaction, writeAudit, type Actor } from './core';

const TARGET = '00000000-0000-4000-8000-000000000002';

export async function getPaygSettings(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    const row = (await client.query<{ enabled: boolean; price_per_message_idr: number | null; updated_at: Date }>(
      'SELECT enabled,price_per_message_idr,updated_at FROM payg_settings WHERE singleton=true',
    )).rows[0];
    await writeAudit(client, actor, 'payg.settings_view', 'payg_settings', TARGET, 'Pengaturan PAYG', {}, requestId, clientIp);
    return { enabled: row?.enabled ?? false, price_per_message_idr: row?.price_per_message_idr ?? null, updated_at: row?.updated_at ?? null };
  });
}

export async function savePaygSettings(db: Pool, actor: Actor, requestId: string, clientIp: string,
  input: { enabled: boolean; pricePerMessageIdr: number }) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    await client.query('SELECT singleton FROM payg_settings WHERE singleton=true FOR UPDATE');
    // Queue entries created under the old package/quota model have no wallet reservation.
    // Close them at cutover so they cannot be delivered for free; the user can review/retry.
    if (input.enabled) {
      await client.query(
        `UPDATE messages SET status='failed',error_message='PAYG_CUTOVER_REQUIRES_REVIEW'
         WHERE status IN ('queued','quota_hold') AND system_otp=false AND system_notification=false
           AND NOT EXISTS (SELECT 1 FROM message_wallet_reservations r WHERE r.message_id=messages.id)`,
      );
    }
    const row = (await client.query<{ enabled: boolean; price_per_message_idr: number; updated_at: Date }>(
      `UPDATE payg_settings SET enabled=$1,price_per_message_idr=$2,updated_at=now(),updated_by=$3
       WHERE singleton=true RETURNING enabled,price_per_message_idr,updated_at`,
      [input.enabled, input.pricePerMessageIdr, actor.id],
    )).rows[0]!;
    await writeAudit(client, actor, 'payg.settings_update', 'payg_settings', TARGET, 'Pengaturan PAYG', {}, requestId, clientIp,
      `enabled=${row.enabled}; tarif=${row.price_per_message_idr} IDR per pesan terkirim`);
    return { enabled: row.enabled, price_per_message_idr: row.price_per_message_idr, updated_at: row.updated_at };
  });
}
