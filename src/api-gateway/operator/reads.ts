import type { Pool, PoolClient } from 'pg';
import { effectiveStatus, looksLikeStudentEmail, usageWindow } from '../../shared/billing';
import { operatorTransaction, OperatorError } from './core';

export interface PageFilter { limit: number; offset: number; q?: string | undefined; status?: string | undefined }
const OWNER_JOIN = `LEFT JOIN LATERAL (
  SELECT u.name, u.email FROM memberships m JOIN users u ON u.id=m.user_id
  WHERE m.tenant_id=t.id AND m.role='owner' ORDER BY m.created_at, u.id LIMIT 1
) owner ON true`;
const OWNER = `CASE WHEN owner.name IS NULL THEN NULL ELSE json_build_object('name',owner.name,'email',owner.email) END`;
const SUB = `CASE WHEN s.tenant_id IS NULL THEN NULL ELSE json_build_object('plan',s.plan_id,'status',s.status,'period_end',s.period_end) END`;
const STUDENT = `CASE WHEN t.student_verified_at IS NOT NULL THEN json_build_object('status','approved')
  ELSE (SELECT json_build_object('status',sr.status) FROM student_requests sr WHERE sr.tenant_id=t.id ORDER BY sr.requested_at DESC,sr.id DESC LIMIT 1) END`;
const INVOICE_COLUMNS = `i.id,i.number,i.cycle,i.amount_idr,i.status,i.created_at,i.due_at,i.version,
  json_build_object('id',t.id,'name',t.name) AS workspace, json_build_object('id',p.id,'name',p.name) AS plan`;

// Legacy billing columns are UTC timestamp-without-time-zone. JSON SQL construction loses pg's Date parser.
function utcIso(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`).toISOString();
}

async function page(db: Pool, select: string, from: string, where: string, order: string, args: unknown[], filter: PageFilter) {
  return operatorTransaction(db, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const total = (await client.query<{ n: number }>(`SELECT count(*)::int AS n ${from} WHERE ${where}`, args)).rows[0]!.n;
    const rows = (await client.query(`SELECT ${select} ${from} WHERE ${where} ORDER BY ${order} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, filter.limit, filter.offset])).rows;
    return { data: rows, pagination: { total, limit: filter.limit, offset: filter.offset, has_more: filter.offset + rows.length < total } };
  });
}

export async function listInvoices(db: Pool, filter: PageFilter) {
  return page(db, INVOICE_COLUMNS, 'FROM invoices i JOIN tenants t ON t.id=i.tenant_id JOIN plans p ON p.id=i.plan_id',
    "($1::text IS NULL OR i.status=$1) AND ($2::text IS NULL OR i.number ILIKE '%' || $2 || '%' OR t.name ILIKE '%' || $2 || '%')",
    'i.created_at DESC,i.id DESC', [filter.status ?? null, filter.q ?? null], filter);
}
export async function invoiceDetail(db: Pool | PoolClient, id: string) {
  const row = (await db.query(`SELECT ${INVOICE_COLUMNS}, i.paid_at,i.method,i.reference,i.note,
    CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id',o.id,'name',o.name) END AS confirmed_by,
    json_build_object('id',t.id,'name',t.name,'owner',${OWNER}) AS workspace,
    ${SUB} AS subscription, ${STUDENT} AS student
    FROM invoices i JOIN tenants t ON t.id=i.tenant_id JOIN plans p ON p.id=i.plan_id
    LEFT JOIN operators o ON o.id=i.confirmed_by LEFT JOIN subscriptions s ON s.tenant_id=t.id ${OWNER_JOIN} WHERE i.id=$1`, [id])).rows[0];
  if (!row) throw new OperatorError(404, 'INVOICE_NOT_FOUND', 'Invoice tidak ditemukan.');
  if (row.subscription) {
    row.subscription.period_end = utcIso(row.subscription.period_end);
    row.subscription.status = effectiveStatus(row.subscription);
  }
  row.timeline = [{ at: row.created_at, event: 'invoice.created' }, ...(row.paid_at ? [{ at: row.paid_at, event: 'invoice.paid' }] : [])];
  return row;
}

const STUDENT_COLUMNS = `r.id,json_build_object('id',t.id,'name',t.name) AS workspace,
  left(r.requester_email,1) || '***@' || split_part(r.requester_email,'@',2) AS requester_email_masked,
  split_part(r.requester_email,'@',2) AS email_domain,r.status,r.requested_at,r.version`;
export async function listStudents(db: Pool, filter: PageFilter) {
  const result = await page(db, STUDENT_COLUMNS, 'FROM student_requests r JOIN tenants t ON t.id=r.tenant_id',
    "($1::text IS NULL OR r.status=$1) AND ($2::text IS NULL OR t.name ILIKE '%' || $2 || '%' OR split_part(r.requester_email,'@',2) ILIKE '%' || $2 || '%')",
    'r.requested_at DESC,r.id DESC', [filter.status ?? null, filter.q ?? null], filter);
  result.data = result.data.map((row) => ({ ...row, academic_domain_hint: looksLikeStudentEmail(`hint@${row.email_domain}`) }));
  return result;
}
export async function studentDetail(db: Pool, id: string) {
  const row = (await db.query(`SELECT ${STUDENT_COLUMNS},r.requester_email,r.note,r.decided_at,r.reason,
    CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('name',o.name) END AS decided_by,
    COALESCE((SELECT json_agg(h ORDER BY h.requested_at DESC,h.id DESC) FROM (
      SELECT old.id,old.status,old.requested_at,old.decided_at,
        CASE WHEN op.id IS NULL THEN NULL ELSE json_build_object('name',op.name) END AS decided_by
      FROM student_requests old LEFT JOIN operators op ON op.id=old.decided_by
      WHERE old.tenant_id=r.tenant_id AND old.id<>r.id
    ) h),'[]'::json) AS history
    FROM student_requests r JOIN tenants t ON t.id=r.tenant_id LEFT JOIN operators o ON o.id=r.decided_by WHERE r.id=$1`, [id])).rows[0];
  if (!row) throw new OperatorError(404, 'REQUEST_NOT_FOUND', 'Pengajuan tidak ditemukan.');
  return { ...row, academic_domain_hint: looksLikeStudentEmail(row.requester_email) };
}

const WORKSPACE_COLUMNS = `t.id,t.name,t.status,t.created_at,${OWNER} AS owner,
  CASE WHEN s.tenant_id IS NULL THEN NULL ELSE json_build_object('plan',json_build_object('id',p.id,'name',p.name),
    'status',s.status,'cycle',s.cycle,'period_start',s.period_start,'period_end',s.period_end) END AS subscription,
  json_build_object('messages_used',t.used_messages,'messages_limit',t.quota_messages,
    'devices_used',(SELECT count(*)::int FROM devices d WHERE d.tenant_id=t.id),'devices_limit',t.max_devices,
    'members_used',(SELECT count(*)::int FROM memberships m WHERE m.tenant_id=t.id),'members_limit',p.max_members) AS usage,
  t.usage_period_start,${STUDENT} AS student`;
const WORKSPACE_FROM = `FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id=t.id LEFT JOIN plans p ON p.id=s.plan_id ${OWNER_JOIN}`;
function workspaceDto(row: Record<string, any>) {
  const { usage_period_start, ...dto } = row;
  if (dto.subscription) {
    dto.subscription.period_start = utcIso(dto.subscription.period_start);
    dto.subscription.period_end = utcIso(dto.subscription.period_end);
    dto.subscription.status = effectiveStatus(dto.subscription);
    dto.subscription.days_left = dto.subscription.period_end ? Math.ceil((new Date(dto.subscription.period_end).getTime()-Date.now())/86_400_000) : null;
    const window = usageWindow(new Date(dto.subscription.period_start));
    if (!usage_period_start || new Date(usage_period_start) < window.start) dto.usage.messages_used = 0;
  }
  return dto;
}
export async function listWorkspaces(db: Pool, filter: PageFilter) {
  const result = await page(db, WORKSPACE_COLUMNS, WORKSPACE_FROM,
    "($1::text IS NULL OR t.name ILIKE '%' || $1 || '%')", 't.created_at DESC,t.id DESC', [filter.q ?? null], filter);
  return { ...result, data: result.data.map(workspaceDto) };
}
export async function workspaceDetail(db: Pool, id: string) {
  const row = (await db.query(`SELECT ${WORKSPACE_COLUMNS} ${WORKSPACE_FROM} WHERE t.id=$1`, [id])).rows[0];
  if (!row) throw new OperatorError(404, 'WORKSPACE_NOT_FOUND', 'Workspace tidak ditemukan.');
  return workspaceDto(row);
}

export interface AuditFilter extends PageFilter { action?: string | undefined; operator_id?: string | undefined; target_type?: string | undefined; target_id?: string | undefined; from: string; to: string }
export async function listAudit(db: Pool, filter: AuditFilter) {
  return page(db, `a.id,a.at,json_build_object('id',o.id,'name',o.name) AS operator,a.action,
    json_build_object('type',a.target_type,'id',a.target_id,'label',a.target_label) AS target,
    a.reason,a.changes,a.request_id`, 'FROM operator_audit a JOIN operators o ON o.id=a.operator_id',
    `a.at >= $1::timestamptz AND a.at < $2::timestamptz AND ($3::text IS NULL OR a.action=$3)
     AND ($4::uuid IS NULL OR a.operator_id=$4) AND ($5::text IS NULL OR a.target_type=$5) AND ($6::uuid IS NULL OR a.target_id=$6)`,
    'a.at DESC,a.id DESC', [filter.from, filter.to, filter.action ?? null, filter.operator_id ?? null, filter.target_type ?? null, filter.target_id ?? null], filter);
}
