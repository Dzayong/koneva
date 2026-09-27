import type { Pool } from 'pg';
import { activatePaid, type PlanRow } from '../services/billing.service';
import { idempotent, writeAudit, OperatorError, type Actor } from './core';

export interface PaymentInput { method: 'transfer' | 'ewallet' | 'qris' | 'tunai' | 'lainnya'; reference?: string | undefined; note?: string | undefined; expected: { amount_idr: number; version: number } }
export async function confirmPayment(db: Pool, actor: Actor, id: string, key: string, input: PaymentInput, requestId: string) {
  try {
    return await idempotent(db, actor, 'invoice.confirm_payment', id, key, input, 'payments:confirm', async (client) => {
      // Workspace first, invoice second: serializes concurrent payments for different invoices of the same workspace.
      const target = (await client.query<{ tenant_id: string }>('SELECT tenant_id FROM invoices WHERE id=$1', [id])).rows[0];
      if (!target) throw new OperatorError(404, 'INVOICE_NOT_FOUND', 'Invoice tidak ditemukan.');
      const tenant = (await client.query<{ student_verified_at: Date | null }>('SELECT student_verified_at FROM tenants WHERE id=$1 FOR UPDATE', [target.tenant_id])).rows[0];
      const invoice = (await client.query(`SELECT i.id,i.number,i.status,i.amount_idr,i.version,i.plan_id,i.cycle,i.paid_at,
        CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('name',o.name) END AS confirmed_by
        FROM invoices i LEFT JOIN operators o ON o.id=i.confirmed_by WHERE i.id=$1 FOR UPDATE OF i`, [id])).rows[0];
      if (!invoice) throw new OperatorError(404, 'INVOICE_NOT_FOUND', 'Invoice tidak ditemukan.');
      if (invoice.status !== 'unpaid') throw new OperatorError(409, 'INVOICE_NOT_PAYABLE', 'Invoice sudah diproses.', { current_status: invoice.status, paid_at: invoice.paid_at, confirmed_by: invoice.confirmed_by });
      if (invoice.amount_idr !== input.expected.amount_idr || invoice.version !== input.expected.version) {
        throw new OperatorError(409, 'INVOICE_CHANGED', 'Invoice berubah. Muat ulang detail.', { current: { amount_idr: invoice.amount_idr, version: invoice.version, status: invoice.status } });
      }
      const plan = (await client.query<PlanRow>(`SELECT id,name,audience,price_month_idr,price_year_idr,max_devices,monthly_messages,max_members,
        trial_days,requires_student_verification,price_is_final,published,sort_order,features FROM plans WHERE id=$1 FOR SHARE`, [invoice.plan_id])).rows[0]!;
      if (plan.requires_student_verification && !tenant?.student_verified_at) throw new OperatorError(409, 'STUDENT_NOT_VERIFIED', 'Status pelajar belum disetujui.');
      const paid = (await client.query(`UPDATE invoices SET status='paid',paid_at=now(),method=$2,reference=$3,note=$4,confirmed_by=$5 WHERE id=$1
        RETURNING id,number,status,version,paid_at,method,reference`, [id, input.method, input.reference?.trim() || null, input.note ?? null, actor.id])).rows[0];
      const period = await activatePaid(client, target.tenant_id, plan, invoice.cycle);
      await writeAudit(client, actor, 'invoice.confirm_payment', 'invoice', id, invoice.number,
        { status: { from: 'unpaid', to: 'paid' }, method: { from: null, to: input.method }, version: { from: invoice.version, to: paid.version } }, requestId);
      return { invoice: { ...paid, confirmed_by: { id: actor.id, name: actor.name } },
        subscription: { plan: plan.id, status: 'active', cycle: invoice.cycle, period_end: period.period_end } };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'constraint' in error && error.constraint === 'invoices_paid_reference_unique') {
      const existing = (await db.query<{ number: string }>(`SELECT number FROM invoices WHERE status='paid'
        AND lower(btrim(method))=lower(btrim($1::text)) AND lower(btrim(reference))=lower(btrim($2::text))`, [input.method, input.reference ?? ''])).rows[0];
      throw new OperatorError(409, 'DUPLICATE_REFERENCE', 'Referensi pembayaran sudah digunakan.', { existing_invoice_number: existing?.number ?? null });
    }
    throw error;
  }
}

export interface DecisionInput { decision: 'approve' | 'reject'; reason?: string | undefined; expected: { request_id: string; version: number } }
export async function decideStudent(db: Pool, actor: Actor, id: string, key: string, input: DecisionInput, requestId: string) {
  return idempotent(db, actor, 'student_request.decision', id, key, input, 'students:decide', async (client) => {
    const target = (await client.query<{ tenant_id: string }>('SELECT tenant_id FROM student_requests WHERE id=$1', [id])).rows[0];
    if (!target) throw new OperatorError(404, 'REQUEST_NOT_FOUND', 'Pengajuan tidak ditemukan.');
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [target.tenant_id]);
    const row = (await client.query(`SELECT r.id,r.status,r.version,r.decided_at,
      CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('name',o.name) END AS decided_by
      FROM student_requests r LEFT JOIN operators o ON o.id=r.decided_by WHERE r.id=$1 FOR UPDATE OF r`, [id])).rows[0];
    if (!row) throw new OperatorError(404, 'REQUEST_NOT_FOUND', 'Pengajuan tidak ditemukan.');
    if (row.status === 'superseded') {
      const latest = (await client.query<{ id: string }>('SELECT id FROM student_requests WHERE tenant_id=$1 ORDER BY requested_at DESC,id DESC LIMIT 1', [target.tenant_id])).rows[0];
      throw new OperatorError(409, 'REQUEST_SUPERSEDED', 'Pengajuan digantikan pengajuan baru.', { latest_request_id: latest?.id });
    }
    if (row.status !== 'pending') throw new OperatorError(409, 'REQUEST_NOT_PENDING', 'Pengajuan sudah diputuskan.', { current_status: row.status, decided_at: row.decided_at, decided_by: row.decided_by });
    if (input.expected.request_id.toLowerCase() !== id || row.version !== input.expected.version) throw new OperatorError(409, 'REQUEST_CHANGED', 'Pengajuan berubah.', { version: row.version });
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    const result = (await client.query(`UPDATE student_requests SET status=$2,version=version+1,decided_at=now(),decided_by=$3,reason=$4 WHERE id=$1
      RETURNING id,status,version,decided_at,reason`, [id, status, actor.id, input.reason?.trim() || null])).rows[0];
    if (status === 'approved') await client.query('UPDATE tenants SET student_verified_at=now() WHERE id=$1', [target.tenant_id]);
    // Rejecting an application never revokes a previously approved entitlement (revoke is outside MVP).
    await writeAudit(client, actor, 'student_request.decision', 'student_request', id, null,
      { status: { from: 'pending', to: status }, version: { from: row.version, to: result.version } }, requestId);
    return { ...result, decided_by: { name: actor.name } };
  });
}
