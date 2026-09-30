import type { PoolClient } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import { ServiceError } from './service-error';

export type RecipientConsentStatus = 'opted_in' | 'opted_out';

export function normalizeRecipientNumber(value: string): string {
  return value.replace(/\D/g, '');
}

interface ConsentQuery {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** API admission check. Only a transaction already verified by trusted server logic may skip stored consent. */
export async function assertRecipientConsent(
  db: ConsentQuery,
  tenantId: string,
  recipient: string,
  serverVerifiedTransactional = false,
): Promise<void> {
  if (serverVerifiedTransactional) return;
  const phoneNumber = normalizeRecipientNumber(recipient);
  const result = await db.query(
    'SELECT status FROM recipient_preferences WHERE tenant_id = $1 AND phone_number = $2',
    [tenantId, phoneNumber],
  );
  const status = result.rows[0]?.status as RecipientConsentStatus | undefined;
  if (status === 'opted_out') {
    throw new ServiceError(409, 'RECIPIENT_OPTED_OUT', 'Recipient has opted out of promotional messages');
  }
  if (status !== 'opted_in') {
    throw new ServiceError(409, 'RECIPIENT_CONSENT_REQUIRED', 'Record recipient consent before sending promotional messages');
  }
}

export async function getContactConsent(tenantId: string, contactId: string): Promise<Record<string, unknown>> {
  const contact = await pool.query<{ phone_number: string; preference_status: string | null; source: string | null; source_note: string | null; evidence_ref: string | null; decided_at: Date | null; decided_by: string | null }>(
    `SELECT regexp_replace(c.phone_number, '[^0-9]', '', 'g') AS phone_number,
            p.status AS preference_status, p.source, p.source_note, p.evidence_ref, p.decided_at, p.decided_by
     FROM contacts c LEFT JOIN recipient_preferences p
       ON p.tenant_id = c.tenant_id AND p.phone_number = regexp_replace(c.phone_number, '[^0-9]', '', 'g')
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [contactId, tenantId],
  );
  if (!contact.rows[0]) throw new ServiceError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  const events = await pool.query(
    `SELECT status, source, source_note, evidence_ref, actor_kind, actor_id, created_at
     FROM recipient_consent_events WHERE tenant_id = $1 AND phone_number = $2
     ORDER BY created_at DESC, id DESC LIMIT 100`,
    [tenantId, contact.rows[0].phone_number],
  );
  return {
    phone_number: contact.rows[0].phone_number,
    status: contact.rows[0].preference_status,
    source: contact.rows[0].source,
    source_note: contact.rows[0].source_note,
    evidence_ref: contact.rows[0].evidence_ref,
    decided_at: contact.rows[0].decided_at,
    decided_by: contact.rows[0].decided_by,
    events: events.rows,
  };
}

export async function recordManualContactConsent(
  tenantId: string,
  contactId: string,
  status: RecipientConsentStatus,
  sourceNote: string,
  actorId: string,
): Promise<Record<string, unknown>> {
  const trimmedNote = sourceNote.trim();
  if (!trimmedNote) throw new ServiceError(400, 'CONSENT_SOURCE_REQUIRED', 'A source note is required to record manual consent');
  return transaction(async (client: PoolClient) => {
    const contact = await client.query<{ phone_number: string }>(
      `SELECT regexp_replace(phone_number, '[^0-9]', '', 'g') AS phone_number
       FROM contacts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [contactId, tenantId],
    );
    const phoneNumber = contact.rows[0]?.phone_number;
    if (!phoneNumber) throw new ServiceError(404, 'CONTACT_NOT_FOUND', 'Contact not found');

    const preference = await client.query(
      `INSERT INTO recipient_preferences (tenant_id, phone_number, status, source, source_note, decided_by, decided_at, updated_at)
       VALUES ($1, $2, $3, 'manual', $4, $5, now(), now())
       ON CONFLICT (tenant_id, phone_number) DO UPDATE SET
         status = EXCLUDED.status, source = 'manual', source_note = EXCLUDED.source_note,
         evidence_ref = NULL, decided_by = EXCLUDED.decided_by, decided_at = now(), updated_at = now()
       RETURNING tenant_id, phone_number, status, source, source_note, evidence_ref, decided_by, decided_at`,
      [tenantId, phoneNumber, status, trimmedNote, actorId],
    );
    await client.query(
      `INSERT INTO recipient_consent_events
         (tenant_id, phone_number, status, source, source_note, actor_kind, actor_id)
       VALUES ($1, $2, $3, 'manual', $4, 'user', $5)`,
      [tenantId, phoneNumber, status, trimmedNote, actorId],
    );
    return preference.rows[0] ?? {};
  });
}
