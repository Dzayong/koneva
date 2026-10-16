import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../shared/database/connection';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';
import { getContactConsent, recordManualContactConsent } from '../services/recipient-consent.service';

const router = Router();
const phone = z.string().regex(/^\+?[1-9]\d{6,19}$/);
const contactBody = z.object({
  phone_number: phone,
  name: z.string().trim().min(1).max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  notes: z.string().max(5000).nullable().optional(),
}).strict();
const updateBody = contactBody.partial().refine((value) => Object.keys(value).length > 0);
const idParams = z.object({ id: z.string().uuid() });
const groupBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const groupMembersBody = z.object({ contact_ids: z.array(z.string().uuid()).max(500) }).strict();
const consentBody = z.object({
  status: z.enum(['opted_in', 'opted_out']),
  source_note: z.string().trim().min(1).max(500),
}).strict();
const listQuery = z.object({
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export const importContactsSchema = z.object({ csv: z.string().min(1).max(900_000) }).strict();

export interface CsvContact { phone_number: string; name?: string; tags: string[]; notes?: string }

function csvRow(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += character;
  }
  if (quoted) throw new ServiceError(400, 'INVALID_CSV', 'CSV contains an unterminated quoted field');
  values.push(value.trim());
  return values;
}

export function parseContactsCsv(csv: string): CsvContact[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new ServiceError(400, 'INVALID_CSV', 'CSV must contain a header and at least one contact');
  const headers = csvRow(lines[0]!).map((header) => header.toLowerCase());
  const phoneIndex = headers.findIndex((header) => ['phone_number', 'phone', 'number'].includes(header));
  if (phoneIndex < 0) throw new ServiceError(400, 'INVALID_CSV', 'CSV header must include phone_number');
  const indexOf = (name: string) => headers.indexOf(name);
  return lines.slice(1).map((line, rowIndex) => {
    const values = csvRow(line);
    const parsed = contactBody.safeParse({
      phone_number: values[phoneIndex],
      name: values[indexOf('name')] || undefined,
      tags: (values[indexOf('tags')] || '').split(/[|;]/).map((tag) => tag.trim()).filter(Boolean),
      notes: values[indexOf('notes')] || undefined,
    });
    if (!parsed.success) throw new ServiceError(400, 'INVALID_CSV', `Invalid contact on CSV row ${rowIndex + 2}`);
    return parsed.data as CsvContact;
  });
}

function duplicateError(error: unknown): never {
  if ((error as { code?: string }).code === '23505') throw new ServiceError(409, 'CONTACT_EXISTS', 'Contact already exists');
  throw error;
}

export async function createContact(request: Request, response: Response): Promise<void> {
  const input = request.validated!.body as z.infer<typeof contactBody>;
  try {
    const result = await pool.query(
      `INSERT INTO contacts (tenant_id, phone_number, name, tags, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [request.tenant!.id, input.phone_number, input.name ?? null, input.tags, input.notes ?? null],
    );
    response.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) { duplicateError(error); }
}

export async function listContacts(request: Request, response: Response): Promise<void> {
  const { search, limit, offset } = request.validated!.query as z.infer<typeof listQuery>;
  const pattern = search ? `%${search}%` : null;
  const result = await pool.query(
    `SELECT *, COUNT(*) OVER()::int AS total FROM contacts
     WHERE tenant_id = $1 AND ($2::text IS NULL OR name ILIKE $2 OR phone_number ILIKE $2
       OR EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE $2))
     ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [request.tenant!.id, pattern, limit, offset],
  );
  const total = Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0);
  response.json({
    success: true,
    data: result.rows.map(({ total: _total, ...row }) => row),
    pagination: { total, limit, offset, has_more: offset + result.rows.length < total },
  });
}

export async function getContact(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query('SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2', [id, request.tenant!.id]);
  if (!result.rows[0]) throw new ServiceError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  response.json({ success: true, data: result.rows[0] });
}

export async function updateContact(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const input = request.validated!.body as z.infer<typeof updateBody>;
  try {
    const result = await pool.query(
      `UPDATE contacts SET phone_number = COALESCE($1, phone_number), name = CASE WHEN $2 THEN $3 ELSE name END,
       tags = COALESCE($4, tags), notes = CASE WHEN $5 THEN $6 ELSE notes END, updated_at = NOW()
       WHERE id = $7 AND tenant_id = $8 RETURNING *`,
      [input.phone_number ?? null, 'name' in input, input.name ?? null, input.tags ?? null,
        'notes' in input, input.notes ?? null, id, request.tenant!.id],
    );
    if (!result.rows[0]) throw new ServiceError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
    response.json({ success: true, data: result.rows[0] });
  } catch (error) { duplicateError(error); }
}

export async function deleteContact(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query('DELETE FROM contacts WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, request.tenant!.id]);
  if (!result.rows[0]) throw new ServiceError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  response.json({ success: true, data: null });
}

export async function listContactGroups(request: Request, response: Response): Promise<void> {
  const result = await pool.query(
    `SELECT g.id, g.name, g.created_at, g.updated_at, count(m.contact_id)::int AS member_count
     FROM contact_groups g LEFT JOIN contact_group_members m
       ON m.group_id = g.id AND m.tenant_id = g.tenant_id
     WHERE g.tenant_id = $1 GROUP BY g.id ORDER BY g.name ASC`, [request.tenant!.id],
  );
  response.json({ success: true, data: result.rows });
}

export async function createContactGroup(request: Request, response: Response): Promise<void> {
  const { name } = request.validated!.body as z.infer<typeof groupBody>;
  try {
    const result = await pool.query(
      `INSERT INTO contact_groups (tenant_id, name) VALUES ($1, $2)
       RETURNING id, name, created_at, updated_at`, [request.tenant!.id, name],
    );
    response.status(201).json({ success: true, data: { ...result.rows[0], member_count: 0 } });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ServiceError(409, 'CONTACT_GROUP_EXISTS', 'A group with this name already exists');
    throw error;
  }
}

export async function updateContactGroup(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const { name } = request.validated!.body as z.infer<typeof groupBody>;
  try {
    const result = await pool.query(
      `UPDATE contact_groups SET name = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3 RETURNING id, name, created_at, updated_at`, [name, id, request.tenant!.id],
    );
    if (!result.rows[0]) throw new ServiceError(404, 'CONTACT_GROUP_NOT_FOUND', 'Contact group not found');
    response.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ServiceError(409, 'CONTACT_GROUP_EXISTS', 'A group with this name already exists');
    throw error;
  }
}

export async function deleteContactGroup(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  try {
    const result = await pool.query('DELETE FROM contact_groups WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, request.tenant!.id]);
    if (!result.rows[0]) throw new ServiceError(404, 'CONTACT_GROUP_NOT_FOUND', 'Contact group not found');
    response.json({ success: true, data: null });
  } catch (error) {
    if ((error as { code?: string }).code === '23503') throw new ServiceError(409, 'CONTACT_GROUP_HAS_CAMPAIGNS', 'A group used by a campaign cannot be deleted');
    throw error;
  }
}

export async function replaceContactGroupMembers(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const { contact_ids } = request.validated!.body as z.infer<typeof groupMembersBody>;
  await transaction(async (client) => {
    const group = await client.query('SELECT id FROM contact_groups WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, request.tenant!.id]);
    if (!group.rows[0]) throw new ServiceError(404, 'CONTACT_GROUP_NOT_FOUND', 'Contact group not found');
    const uniqueIds = [...new Set(contact_ids)];
    if (uniqueIds.length) {
      const count = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM contacts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [request.tenant!.id, uniqueIds],
      );
      if (Number(count.rows[0]?.count ?? 0) !== uniqueIds.length) throw new ServiceError(400, 'INVALID_CONTACT_GROUP_MEMBERS', 'One or more contacts do not belong to this workspace');
    }
    await client.query('DELETE FROM contact_group_members WHERE group_id = $1 AND tenant_id = $2', [id, request.tenant!.id]);
    if (uniqueIds.length) {
      await client.query(
        `INSERT INTO contact_group_members (tenant_id, group_id, contact_id)
         SELECT $1, $2, unnest($3::uuid[])`, [request.tenant!.id, id, uniqueIds],
      );
    }
  });
  response.json({ success: true, data: { group_id: id, member_count: new Set(contact_ids).size } });
}

export async function listContactGroupMembers(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const exists = await pool.query('SELECT 1 FROM contact_groups WHERE id = $1 AND tenant_id = $2', [id, request.tenant!.id]);
  if (!exists.rows[0]) throw new ServiceError(404, 'CONTACT_GROUP_NOT_FOUND', 'Contact group not found');
  const result = await pool.query(
    `SELECT c.id, c.name, c.phone_number, c.tags
     FROM contact_group_members m JOIN contacts c ON c.id = m.contact_id AND c.tenant_id = m.tenant_id
     WHERE m.group_id = $1 AND m.tenant_id = $2 ORDER BY c.name NULLS LAST, c.phone_number`, [id, request.tenant!.id],
  );
  response.json({ success: true, data: result.rows });
}

export async function readContactConsent(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  response.json({ success: true, data: await getContactConsent(request.tenant!.id, id) });
}

export async function setContactConsent(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const input = request.validated!.body as z.infer<typeof consentBody>;
  const actor = request.actor;
  if (!actor || actor.kind !== 'user') {
    throw new ServiceError(403, 'CONSENT_ACTOR_REQUIRED', 'A signed-in workspace member must record manual consent');
  }
  const data = await recordManualContactConsent(request.tenant!.id, id, input.status, input.source_note, actor.userId);
  response.status(200).json({ success: true, data });
}

export async function importContacts(request: Request, response: Response): Promise<void> {
  const contacts = parseContactsCsv((request.validated!.body as z.infer<typeof importContactsSchema>).csv);
  const imported = await transaction(async (client) => {
    let count = 0;
    for (const contact of contacts) {
      await client.query(
        `INSERT INTO contacts (tenant_id, phone_number, name, tags, notes) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, phone_number) DO UPDATE SET name=EXCLUDED.name, tags=EXCLUDED.tags,
         notes=EXCLUDED.notes, updated_at=NOW()`,
        [request.tenant!.id, contact.phone_number, contact.name ?? null, contact.tags, contact.notes ?? null],
      );
      count += 1;
    }
    return count;
  });
  response.status(201).json({ success: true, data: { imported } });
}

router.post('/contacts/import', validate({ body: importContactsSchema }), importContacts);
router.post('/contacts', validate({ body: contactBody }), createContact);
router.get('/contacts', validate({ query: listQuery }), listContacts);
router.get('/contacts/:id/consent', validate({ params: idParams }), readContactConsent);
router.put('/contacts/:id/consent', validate({ params: idParams, body: consentBody }), setContactConsent);
router.get('/contacts/:id', validate({ params: idParams }), getContact);
router.patch('/contacts/:id', validate({ params: idParams, body: updateBody }), updateContact);
router.delete('/contacts/:id', validate({ params: idParams }), deleteContact);
router.get('/contact-groups', listContactGroups);
router.post('/contact-groups', validate({ body: groupBody }), createContactGroup);
router.patch('/contact-groups/:id', validate({ params: idParams, body: groupBody }), updateContactGroup);
router.delete('/contact-groups/:id', validate({ params: idParams }), deleteContactGroup);
router.get('/contact-groups/:id/members', validate({ params: idParams }), listContactGroupMembers);
router.put('/contact-groups/:id/members', validate({ params: idParams, body: groupMembersBody }), replaceContactGroupMembers);
export default router;
