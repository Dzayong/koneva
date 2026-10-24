import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';
import { isSafeAutoReplyRegex } from '../../shared/safe-auto-reply-regex';
import { getWorkspaceWorkHours } from '../../shared/work-hours';
import { EMPTY_AI_REPLY_RULE_CONFIG } from '../../shared/ai-reply-skills';

const router = Router();
const idSchema = z.object({ id: z.string().uuid() });
const triggerPattern = z.string().max(128);
const aiReplyConfigSchema = z.object({
  skill_ids: z.array(z.enum(['customer_service', 'shop_assistant', 'faq_helper', 'research_context'])).max(4).default([]),
  reply_to_trigger: z.boolean().default(true),
  variables: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(1000)).default({})
    .refine((variables) => Object.keys(variables).length <= 12, 'Maksimal 12 variabel usaha.')
    .refine((variables) => !Object.keys(variables).some((key) => ['nama', 'nomor', 'tanggal'].includes(key)), 'Nama variabel nama, nomor, dan tanggal sudah disediakan otomatis.'),
}).strict().default({ ...EMPTY_AI_REPLY_RULE_CONFIG, reply_to_trigger: true });
const ruleBody = z.object({
  device_key: z.string().min(1).max(32),
  trigger_type: z.enum(['keyword', 'regex', 'all']),
  trigger_pattern: triggerPattern.default(''),
  response_type: z.enum(['text', 'template', 'ai', 'ai_general']).default('text'),
  response_content: z.string().max(4096),
  response_config: aiReplyConfigSchema,
  delay_ms: z.number().int().min(0).max(300_000).default(3000),
  is_active: z.boolean().default(true),
}).strict().superRefine((input, context) => {
  if (input.trigger_type !== 'all' && input.trigger_pattern.trim().length === 0) {
    context.addIssue({ code: 'custom', path: ['trigger_pattern'], message: 'Trigger pattern is required' });
  }
  if (input.trigger_type === 'regex' && !isSafeAutoReplyRegex(input.trigger_pattern)) {
    context.addIssue({ code: 'custom', path: ['trigger_pattern'], message: 'Regex tidak valid atau terlalu kompleks. Gunakan pola sederhana tanpa grup atau alternasi.' });
  }
  if ((input.response_type === 'text' || input.response_type === 'template') && input.response_content.trim().length === 0) {
    context.addIssue({ code: 'custom', path: ['response_content'], message: 'Isi balasan atau instruksi AI wajib diisi' });
  }
  if (input.response_type === 'ai' && !input.response_content.trim() && input.response_config.skill_ids.length === 0) {
    context.addIssue({ code: 'custom', path: ['response_content'], message: 'Isi instruksi atau pilih minimal satu skill.' });
  }
});
const updateBody = z.object({
  device_key: z.string().min(1).max(32).optional(),
  trigger_type: z.enum(['keyword', 'regex', 'all']).optional(),
  trigger_pattern: triggerPattern.optional(),
  response_type: z.enum(['text', 'template', 'ai', 'ai_general']).optional(),
  response_content: z.string().max(4096).optional(),
  response_config: aiReplyConfigSchema.optional(),
  delay_ms: z.number().int().min(0).max(300_000).optional(),
  is_active: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'At least one update is required');
const listSchema = z.object({
  device_key: z.string().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function notifyBotReloadRules(deviceKey: string): Promise<void> {
  await getRedisClient(config.redis.url).publish(
    `bot:reload-rules:${deviceKey}`,
    JSON.stringify({ timestamp: Date.now() }),
  );
}

async function assertOwnedDevice(tenantId: string, deviceKey: string): Promise<void> {
  const result = await pool.query('SELECT 1 FROM devices WHERE tenant_id=$1 AND device_key=$2', [tenantId, deviceKey]);
  if (!result.rows[0]) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
}

function assertWorkspaceManager(request: Request): void {
  if (request.actor?.kind !== 'user' || !['owner', 'developer'].includes(request.actor.role)) {
    throw new ServiceError(403, 'WORKSPACE_MANAGER_REQUIRED', 'Hanya Owner atau Developer yang dapat mengatur jam kerja workspace.');
  }
}

const workHoursBody = z.object({
  enabled: z.boolean(),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict().refine((value) => value.start_time < value.end_time, {
  path: ['end_time'], message: 'Jam selesai harus setelah jam mulai.',
});

export async function getWorkspaceSendHours(request: Request, response: Response): Promise<void> {
  assertWorkspaceManager(request);
  response.json({ success: true, data: await getWorkspaceWorkHours(request.tenant!.id, (text, params) => pool.query(text, params)) });
}

export async function updateWorkspaceSendHours(request: Request, response: Response): Promise<void> {
  assertWorkspaceManager(request);
  const input = request.validated!.body as z.infer<typeof workHoursBody>;
  const result = await pool.query(
    `INSERT INTO workspace_send_hours (tenant_id, enabled, start_time, end_time, updated_at)
     VALUES ($1,$2,$3::time,$4::time,now())
     ON CONFLICT (tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled, start_time=EXCLUDED.start_time,
       end_time=EXCLUDED.end_time, updated_at=now()
     RETURNING enabled, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time`,
    [request.tenant!.id, input.enabled, input.start_time, input.end_time],
  );
  response.json({ success: true, data: result.rows[0] });
}

export async function listAutoReplyRules(request: Request, response: Response): Promise<void> {
  const { device_key, limit, offset } = request.validated!.query as z.infer<typeof listSchema>;
  const result = await pool.query(
    `SELECT *, COUNT(*) OVER()::int AS total FROM auto_reply_rules
     WHERE tenant_id=$1 AND ($2::text IS NULL OR device_key=$2)
     ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [request.tenant!.id, device_key ?? null, limit, offset],
  );
  const total = Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0);
  response.json({
    success: true,
    data: result.rows.map(({ total: _total, ...row }) => row),
    pagination: { total, limit, offset, has_more: offset + result.rows.length < total },
  });
}

export async function getAutoReplyRule(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query('SELECT * FROM auto_reply_rules WHERE id=$1 AND tenant_id=$2', [id, request.tenant!.id]);
  if (!result.rows[0]) throw new ServiceError(404, 'AUTO_REPLY_RULE_NOT_FOUND', 'Auto-reply rule not found');
  response.json({ success: true, data: result.rows[0] });
}

export async function createAutoReplyRule(request: Request, response: Response): Promise<void> {
  const input = request.validated!.body as z.infer<typeof ruleBody>;
  await assertOwnedDevice(request.tenant!.id, input.device_key);
  const result = await pool.query(
    `INSERT INTO auto_reply_rules (tenant_id, device_key, trigger_type, trigger_pattern,
       response_type, response_content, response_config, delay_ms, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
    [request.tenant!.id, input.device_key, input.trigger_type, input.trigger_pattern,
      input.response_type, input.response_content, JSON.stringify(input.response_config), input.delay_ms, input.is_active],
  );
  await notifyBotReloadRules(input.device_key);
  response.status(201).json({ success: true, data: result.rows[0] });
}

export async function updateAutoReplyRule(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const input = request.validated!.body as z.infer<typeof updateBody>;
  const existingResult = await pool.query(
    'SELECT * FROM auto_reply_rules WHERE id=$1 AND tenant_id=$2',
    [id, request.tenant!.id],
  );
  const existing = existingResult.rows[0] as (z.infer<typeof ruleBody> & { id: string; response_config?: unknown }) | undefined;
  if (!existing) throw new ServiceError(404, 'AUTO_REPLY_RULE_NOT_FOUND', 'Auto-reply rule not found');
  const merged = ruleBody.safeParse({
    device_key: input.device_key ?? existing.device_key,
    trigger_type: input.trigger_type ?? existing.trigger_type,
    trigger_pattern: input.trigger_pattern ?? existing.trigger_pattern,
    response_type: input.response_type ?? existing.response_type,
    response_content: input.response_content ?? existing.response_content,
    response_config: input.response_config ?? existing.response_config ?? EMPTY_AI_REPLY_RULE_CONFIG,
    delay_ms: input.delay_ms ?? existing.delay_ms,
    is_active: input.is_active ?? existing.is_active,
  });
  if (!merged.success) throw new ServiceError(400, 'INVALID_AUTO_REPLY_RULE', merged.error.issues[0]?.message ?? 'Invalid rule');
  await assertOwnedDevice(request.tenant!.id, merged.data.device_key);
  const result = await pool.query(
    `UPDATE auto_reply_rules SET device_key=$1, trigger_type=$2, trigger_pattern=$3,
       response_type=$4, response_content=$5, response_config=$6::jsonb, delay_ms=$7, is_active=$8, updated_at=NOW()
     WHERE id=$9 AND tenant_id=$10 RETURNING *`,
    [merged.data.device_key, merged.data.trigger_type, merged.data.trigger_pattern,
      merged.data.response_type, merged.data.response_content, JSON.stringify(merged.data.response_config),
      merged.data.delay_ms, merged.data.is_active, id, request.tenant!.id],
  );
  const row = result.rows[0] as { device_key: string } | undefined;
  if (!row) throw new ServiceError(404, 'AUTO_REPLY_RULE_NOT_FOUND', 'Auto-reply rule not found');
  await Promise.all([...new Set([existing.device_key, row.device_key])].map(notifyBotReloadRules));
  response.json({ success: true, data: row });
}

export async function toggleAutoReplyRule(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query(
    `UPDATE auto_reply_rules SET is_active=NOT is_active, updated_at=NOW()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [id, request.tenant!.id],
  );
  const row = result.rows[0] as { device_key: string } | undefined;
  if (!row) throw new ServiceError(404, 'AUTO_REPLY_RULE_NOT_FOUND', 'Auto-reply rule not found');
  await notifyBotReloadRules(row.device_key);
  response.json({ success: true, data: row });
}

export async function deleteAutoReplyRule(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query(
    'DELETE FROM auto_reply_rules WHERE id=$1 AND tenant_id=$2 RETURNING device_key',
    [id, request.tenant!.id],
  );
  const row = result.rows[0] as { device_key: string } | undefined;
  if (!row) throw new ServiceError(404, 'AUTO_REPLY_RULE_NOT_FOUND', 'Auto-reply rule not found');
  await notifyBotReloadRules(row.device_key);
  response.json({ success: true, data: null });
}

router.get('/auto-reply-rules', validate({ query: listSchema }), listAutoReplyRules);
router.get('/workspace/send-hours', getWorkspaceSendHours);
router.put('/workspace/send-hours', validate({ body: workHoursBody }), updateWorkspaceSendHours);
router.post('/auto-reply-rules', validate({ body: ruleBody }), createAutoReplyRule);
router.get('/auto-reply-rules/:id', validate({ params: idSchema }), getAutoReplyRule);
router.patch('/auto-reply-rules/:id', validate({ params: idSchema, body: updateBody }), updateAutoReplyRule);
router.post('/auto-reply-rules/:id/toggle', validate({ params: idSchema }), toggleAutoReplyRule);
router.delete('/auto-reply-rules/:id', validate({ params: idSchema }), deleteAutoReplyRule);
export default router;
