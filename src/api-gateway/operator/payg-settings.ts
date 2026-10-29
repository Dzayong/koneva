import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PAYG_PRICING_TIERS } from '../../shared/payg-pricing';
import { lockActor, operatorTransaction, writeAudit, type Actor } from './core';

const TARGET = '00000000-0000-4000-8000-000000000002';
const ESTIMATED_VARIABLE_COST_PER_MSG_IDR = 3.2;

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

export async function getPaygRevenueInsights(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'payg.revenue_insights.view', 'system_insights', randomUUID(), 'PAYG Revenue', {}, requestId, clientIp);
  });

  const [byCategory, byWorkspace, topups, aiCost] = await Promise.all([
    db.query<{
      billing_category: string; captured_count: number; captured_idr: number;
      released_count: number; released_idr: number; pending_count: number; pending_idr: number;
    }>(`SELECT r.billing_category,
          count(*) FILTER (WHERE r.state='captured')::int AS captured_count,
          COALESCE(sum(r.amount_idr) FILTER (WHERE r.state='captured'),0)::bigint AS captured_idr,
          count(*) FILTER (WHERE r.state='released')::int AS released_count,
          COALESCE(sum(r.amount_idr) FILTER (WHERE r.state='released'),0)::bigint AS released_idr,
          count(*) FILTER (WHERE r.state='debited')::int AS pending_count,
          COALESCE(sum(r.amount_idr) FILTER (WHERE r.state='debited'),0)::bigint AS pending_idr
        FROM message_wallet_reservations r
        GROUP BY r.billing_category ORDER BY r.billing_category`),
    db.query<{
      tenant_id: string; name: string; pricing_tier_code: string; lifetime_spent_idr: number;
      captured_count: number; captured_idr: number; available_idr: number;
    }>(`SELECT w.tenant_id, t.name,
          COALESCE((SELECT r2.pricing_tier_code FROM message_wallet_reservations r2
            WHERE r2.tenant_id=w.tenant_id ORDER BY r2.created_at DESC LIMIT 1),'starter') AS pricing_tier_code,
          w.lifetime_spent_idr::bigint AS lifetime_spent_idr,
          COALESCE((SELECT count(*)::int FROM message_wallet_reservations r3
            WHERE r3.tenant_id=w.tenant_id AND r3.state='captured'),0) AS captured_count,
          COALESCE((SELECT sum(r4.amount_idr)::bigint FROM message_wallet_reservations r4
            WHERE r4.tenant_id=w.tenant_id AND r4.state='captured'),0) AS captured_idr,
          w.available_idr::bigint AS available_idr
        FROM wallet_accounts w JOIN tenants t ON t.id=w.tenant_id AND t.is_system=false
        ORDER BY w.lifetime_spent_idr DESC LIMIT 50`),
    db.query<{ total_topups_idr: number; total_vouchers_idr: number; total_funded_idr: number; topup_count: number }>(`
      SELECT
        COALESCE(sum(amount_idr) FILTER (WHERE event_type='topup'),0)::bigint AS total_topups_idr,
        COALESCE(sum(amount_idr) FILTER (WHERE event_type='voucher'),0)::bigint AS total_vouchers_idr,
        COALESCE(sum(amount_idr) FILTER (WHERE event_type IN ('topup','voucher')),0)::bigint AS total_funded_idr,
        count(*) FILTER (WHERE event_type='topup')::int AS topup_count
      FROM wallet_ledger`),
    db.query<{ ai_captured_count: number; ai_captured_idr: number; ai_avg_price_idr: number }>(`
      SELECT count(*)::int AS ai_captured_count,
             COALESCE(sum(amount_idr),0)::bigint AS ai_captured_idr,
             COALESCE(avg(unit_price_idr),0)::numeric(10,2) AS ai_avg_price_idr
      FROM message_wallet_reservations WHERE billing_category='ai_reply' AND state='captured'`),
  ]);

  const categories = byCategory.rows.map((r) => ({
    billing_category: r.billing_category,
    captured: { count: Number(r.captured_count), idr: Number(r.captured_idr) },
    released: { count: Number(r.released_count), idr: Number(r.released_idr) },
    pending: { count: Number(r.pending_count), idr: Number(r.pending_idr) },
  }));
  const totalRevenue = categories.reduce((sum, c) => sum + c.captured.idr, 0);
  const totalMessages = categories.reduce((sum, c) => sum + c.captured.count, 0);
  const estimatedCost = Math.round(totalMessages * ESTIMATED_VARIABLE_COST_PER_MSG_IDR);
  const funding = topups.rows[0]!;

  const ai = aiCost.rows[0]!;
  const aiFloor = PAYG_PRICING_TIERS[PAYG_PRICING_TIERS.length - 1]!.prices.ai_reply;

  return {
    measured_at: new Date().toISOString(),
    revenue_by_category: categories,
    totals: {
      revenue_idr: totalRevenue,
      messages_charged: totalMessages,
      estimated_variable_cost_idr: estimatedCost,
      estimated_margin_idr: totalRevenue - estimatedCost,
      margin_percent: totalRevenue ? Math.round(((totalRevenue - estimatedCost) / totalRevenue) * 10000) / 100 : 0,
    },
    funding: {
      total_topups_idr: Number(funding.total_topups_idr),
      total_vouchers_idr: Number(funding.total_vouchers_idr),
      total_funded_idr: Number(funding.total_funded_idr),
      topup_count: Number(funding.topup_count),
      unspent_balance_idr: Number(funding.total_funded_idr) - totalRevenue,
    },
    ai_cost_alert: {
      captured_count: Number(ai.ai_captured_count),
      revenue_idr: Number(ai.ai_captured_idr),
      avg_selling_price_idr: Number(ai.ai_avg_price_idr),
      floor_price_idr: aiFloor,
      warning: Number(ai.ai_avg_price_idr) > 0 && Number(ai.ai_avg_price_idr) <= aiFloor * 1.2,
    },
    workspaces: byWorkspace.rows.map((r) => ({
      tenant_id: r.tenant_id,
      name: r.name,
      pricing_tier_code: r.pricing_tier_code,
      lifetime_spent_idr: Number(r.lifetime_spent_idr),
      captured_count: Number(r.captured_count),
      captured_idr: Number(r.captured_idr),
      available_idr: Number(r.available_idr),
    })),
    pricing_tiers: PAYG_PRICING_TIERS.map((t) => ({
      code: t.code, min_spent_idr: t.minSpentIdr, next_at_idr: t.nextAtIdr, prices: t.prices,
    })),
  };
}
