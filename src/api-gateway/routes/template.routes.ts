import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import type { TenantContext } from '../../shared/types/api';
import { renderMessageTemplate, templateVariables } from '../../shared/utils/message-template';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';

const router = Router();
const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().min(1).max(4096),
  is_active: z.boolean().default(true),
}).strict();
const updateSchema = bodySchema.partial().refine((value) => Object.keys(value).length > 0);
const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const renderSchema = z.object({
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
}).strict();

function formatTemplate(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, variables: templateVariables(String(row.content)) };
}

function handleDuplicate(error: unknown): never {
  if ((error as { code?: string }).code === '23505') throw new ServiceError(409, 'TEMPLATE_EXISTS', 'Template name already exists');
  throw error;
}

export async function createTemplate(request: Request, response: Response): Promise<void> {
  const input = request.validated!.body as z.infer<typeof bodySchema>;
  try {
    const result = await pool.query(
      `INSERT INTO message_templates (tenant_id, name, content, is_active) VALUES ($1,$2,$3,$4) RETURNING *`,
      [request.tenant!.id, input.name, input.content, input.is_active],
    );
    response.status(201).json({ success: true, data: formatTemplate(result.rows[0]!) });
  } catch (error) { handleDuplicate(error); }
}

export async function listTemplates(request: Request, response: Response): Promise<void> {
  const { search, limit, offset } = request.validated!.query as z.infer<typeof listSchema>;
  const result = await pool.query(
    `SELECT *, COUNT(*) OVER()::int AS total FROM message_templates
     WHERE tenant_id=$1 AND ($2::text IS NULL OR name ILIKE $2 OR content ILIKE $2)
     ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [request.tenant!.id, search ? `%${search}%` : null, limit, offset],
  );
  const total = Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0);
  response.json({
    success: true,
    data: result.rows.map(({ total: _total, ...row }) => formatTemplate(row)),
    pagination: { total, limit, offset, has_more: offset + result.rows.length < total },
  });
}

async function ownedTemplate(tenantId: string, id: string): Promise<Record<string, unknown>> {
  const result = await pool.query('SELECT * FROM message_templates WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
  if (!result.rows[0]) throw new ServiceError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
  return result.rows[0];
}

export async function getTemplate(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  response.json({ success: true, data: formatTemplate(await ownedTemplate(request.tenant!.id, id)) });
}

export async function updateTemplate(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const input = request.validated!.body as z.infer<typeof updateSchema>;
  try {
    const result = await pool.query(
      `UPDATE message_templates SET name=COALESCE($1,name), content=COALESCE($2,content),
       is_active=COALESCE($3,is_active), updated_at=NOW() WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [input.name ?? null, input.content ?? null, input.is_active ?? null, id, request.tenant!.id],
    );
    if (!result.rows[0]) throw new ServiceError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    response.json({ success: true, data: formatTemplate(result.rows[0]) });
  } catch (error) { handleDuplicate(error); }
}

export async function deleteTemplate(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query('DELETE FROM message_templates WHERE id=$1 AND tenant_id=$2 RETURNING id', [id, request.tenant!.id]);
  if (!result.rows[0]) throw new ServiceError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
  response.json({ success: true, data: null });
}

export async function renderTemplate(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const template = await ownedTemplate(request.tenant!.id, id);
  const { variables } = request.validated!.body as z.infer<typeof renderSchema>;
  response.json({ success: true, data: { content: renderMessageTemplate(String(template.content), variables) } });
}

router.post('/templates', validate({ body: bodySchema }), createTemplate);
router.get('/templates', validate({ query: listSchema }), listTemplates);
router.get('/templates/:id', validate({ params: idSchema }), getTemplate);
router.patch('/templates/:id', validate({ params: idSchema, body: updateSchema }), updateTemplate);
router.delete('/templates/:id', validate({ params: idSchema }), deleteTemplate);
router.post('/templates/:id/render', validate({ params: idSchema, body: renderSchema }), renderTemplate);
export default router;
