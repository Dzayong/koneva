import type { PoolClient } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import logger from '../../shared/utils/logger';
import { normalizeRecipientNumber, withRecipientConsentLock } from '../../shared/recipient-consent';
import { ServiceError } from './service-error';

export { normalizeRecipientNumber } from '../../shared/recipient-consent';

export type RecipientConsentStatus = 'opted_in' | 'opted_out';

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
    logger.warn('Promotional send denied by recipient consent', {
      tenant_id: tenantId,
      recipient_last4: phoneNumber.slice(-4),
      error_code: 'RECIPIENT_OPTED_OUT',
    });
    throw new ServiceError(409, 'RECIPIENT_OPTED_OUT', 'Recipient has opted out of promotional messages');
  }
  if (status !== 'opted_in') {
    logger.warn('Promotional send denied by recipient consent', {
      tenant_id: tenantId,
      recipient_last4: phoneNumber.slice(-4),
      error_code: 'RECIPIENT_CONSENT_REQUIRED',
    });
    throw new ServiceError(409, 'RECIPIENT_CONSENT_REQUIRED', 'Record recipient consent before sending promotional messages');
  }
}

/** A customer-started chat can receive a contextual reply without an opt-in command, but STOP still wins. */
export async function assertReplyRecipientAllowed(
  db: ConsentQuery,
  tenantId: string,
  recipient: string,
): Promise<void> {
  const phoneNumber = normalizeRecipientNumber(recipient);
  const result = await db.query(
    'SELECT status FROM recipient_preferences WHERE tenant_id = $1 AND phone_number = $2',
    [tenantId, phoneNumber],
  );
  if (result.rows[0]?.status === 'opted_out') {
    throw new ServiceError(409, 'RECIPIENT_OPTED_OUT', 'Recipient has opted out of messages');
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
  const lookup = await pool.query<{ phone_number: string }>(
    `SELECT regexp_replace(phone_number, '[^0-9]', '', 'g') AS phone_number
     FROM contacts WHERE id = $1 AND tenant_id = $2`, [contactId, tenantId]);
  const lockedPhone = lookup.rows[0]?.phone_number;
  if (!lockedPhone) throw new ServiceError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  return withRecipientConsentLock(tenantId, lockedPhone, () => transaction(async (client: PoolClient) => {
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
    if (status === 'opted_out') {
      await client.query(
        `UPDATE messages SET status = 'blocked', error_message = 'recipient_opted_out'
         WHERE tenant_id = $1 AND regexp_replace(to_number, '[^0-9]', '', 'g') = $2
           AND direction = 'outbound' AND status IN ('queued', 'quota_hold')
           AND COALESCE(quota_exempt, false) = false`,
        [tenantId, phoneNumber],
      );
    }
    return preference.rows[0] ?? {};
  }));
}

/**
 * Record opt-in captured by a customer's own signup/checkout flow. The API key holder attests that
 * the recipient saw the stated WhatsApp notice and actively accepted it. evidenceRef should point
 * to that customer's immutable signup/consent record; it is idempotent within a workspace.
 */
export async function recordApiSignupConsent(
  tenantId: string,
  recipient: string,
  consentText: string,
  evidenceRef: string,
  apiKeyId: string,
): Promise<Record<string, unknown>> {
  const phoneNumber = normalizeRecipientNumber(recipient);
  const trimmedText = consentText.trim();
  const trimmedRef = evidenceRef.trim();
  if (phoneNumber.length < 7 || phoneNumber.length > 20) {
    throw new ServiceError(400, 'INVALID_PHONE_NUMBER', 'Recipient phone number is invalid');
  }
  if (trimmedText.length < 10) {
    throw new ServiceError(400, 'CONSENT_TEXT_REQUIRED', 'Provide the WhatsApp consent wording shown to the recipient');
  }
  if (!trimmedRef) throw new ServiceError(400, 'CONSENT_EVIDENCE_REQUIRED', 'Provide an immutable signup or consent record ID');

  try {
    return await withRecipientConsentLock(tenantId, phoneNumber, () => transaction(async (client: PoolClient) => {
    const priorEvent = await client.query<{ phone_number: string; source_note: string | null; status: string }>(
      `SELECT phone_number, source_note, status FROM recipient_consent_events
       WHERE tenant_id = $1 AND source = 'signup_api' AND evidence_ref = $2`, [tenantId, trimmedRef],
    );
    if (priorEvent.rows[0]) {
      const prior = priorEvent.rows[0];
      if (prior.phone_number !== phoneNumber || prior.source_note !== trimmedText || prior.status !== 'opted_in') {
        throw new ServiceError(409, 'CONSENT_EVIDENCE_CONFLICT', 'This evidence ID is already linked to different consent data');
      }
      const current = await client.query(
        `SELECT tenant_id, phone_number, status, source, source_note, evidence_ref, decided_at
         FROM recipient_preferences WHERE tenant_id = $1 AND phone_number = $2`, [tenantId, phoneNumber],
      );
      return current.rows[0] ?? { tenant_id: tenantId, phone_number: phoneNumber, status: prior.status, source: 'signup_api', source_note: trimmedText, evidence_ref: trimmedRef };
    }

    await client.query(
      `INSERT INTO recipient_consent_events
         (tenant_id, phone_number, status, source, source_note, evidence_ref, actor_kind, actor_id)
       VALUES ($1, $2, 'opted_in', 'signup_api', $3, $4, 'api_key', $5)`,
      [tenantId, phoneNumber, trimmedText, trimmedRef, apiKeyId],
    );
    const preference = await client.query(
      `INSERT INTO recipient_preferences (tenant_id, phone_number, status, source, source_note, evidence_ref, decided_by, decided_at, updated_at)
       VALUES ($1, $2, 'opted_in', 'signup_api', $3, $4, NULL, now(), now())
       ON CONFLICT (tenant_id, phone_number) DO UPDATE SET
         status = 'opted_in', source = 'signup_api', source_note = EXCLUDED.source_note,
         evidence_ref = EXCLUDED.evidence_ref, decided_by = NULL, decided_at = now(), updated_at = now()
       RETURNING tenant_id, phone_number, status, source, source_note, evidence_ref, decided_at`,
      [tenantId, phoneNumber, trimmedText, trimmedRef],
    );
    return preference.rows[0] ?? {};
    }));
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ServiceError(409, 'CONSENT_EVIDENCE_CONFLICT', 'This evidence ID is already linked to another consent record');
    }
    throw error;
  }
}
