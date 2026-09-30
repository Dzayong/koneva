import pool from './database/connection';

export function normalizeRecipientNumber(value: string): string {
  return value.replace(/\D/g, '');
}

export type ConsentKeyword = 'stop' | 'start' | undefined;

export type StoredConsentStatus = 'opted_in' | 'opted_out' | undefined;

export async function getStoredRecipientConsent(
  queryFn: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  tenantId: string,
  recipient: string,
): Promise<StoredConsentStatus> {
  const result = await queryFn(
    'SELECT status FROM recipient_preferences WHERE tenant_id = $1 AND phone_number = $2',
    [tenantId, normalizeRecipientNumber(recipient)],
  );
  const status = result.rows[0]?.status;
  return status === 'opted_in' || status === 'opted_out' ? status : undefined;
}

/** Only a standalone command matches; punctuation is ignored, words are not. */
export function parseConsentKeyword(content: string): ConsentKeyword {
  const normalized = content
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
  if (normalized === 'stop' || normalized === 'berhenti') return 'stop';
  if (normalized === 'start' || normalized === 'mulai') return 'start';
  return undefined;
}

/** Session-scoped advisory lock shared by inbound consent changes and final outbound transport. */
export async function withRecipientConsentLock<T>(
  tenantId: string,
  recipient: string,
  work: () => Promise<T>,
): Promise<T> {
  return withRecipientConsentLocks(tenantId, [recipient], work);
}

/** Lock several recipients in deterministic order for one multi-recipient status post. */
export async function withRecipientConsentLocks<T>(
  tenantId: string,
  recipients: string[],
  work: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const lockKeys = [...new Set(recipients.map((recipient) => `${tenantId}:${normalizeRecipientNumber(recipient)}`))].sort();
  const locked: string[] = [];
  try {
    for (const lockKey of lockKeys) {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      locked.push(lockKey);
    }
    return await work();
  } finally {
    try {
      for (const lockKey of locked.reverse()) {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      }
    } finally {
      client.release();
    }
  }
}
