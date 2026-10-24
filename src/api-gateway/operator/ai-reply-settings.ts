import type { Pool } from 'pg';
import { decryptAiReplySecret, encryptAiReplySecret, normalizeAiReplyBaseUrl } from '../../shared/ai-reply-provider';
import { isSafeAutoReplyRegex } from '../../shared/safe-auto-reply-regex';
import { OperatorError, lockActor, operatorTransaction, writeAudit, type Actor } from './core';

interface ProviderConfig { baseUrl: string; model: string; apiKey: string; enabled: boolean }
interface ProviderRow { settings_enc: string; updated_at: Date }

export function buildAiReplySystemInstruction(responseType: 'ai' | 'ai_general', rolePrompt: string): string {
  if (responseType === 'ai_general') {
    return 'Kamu adalah asisten layanan pelanggan yang ramah dan profesional. Jawab hanya berdasarkan informasi yang tersedia di pesan pengguna. Jika informasi tidak cukup, tanyakan dengan singkat; jangan mengarang harga, kebijakan, atau mengaku melakukan tindakan yang belum dilakukan. Balas dalam bahasa yang digunakan pengguna dan secara ringkas.';
  }
  return `Ikuti peran dan aturan berikut. Balas hanya pesan pemicu ini dengan singkat dan relevan. Jangan mengaku melakukan tindakan yang belum dilakukan.\n\n${rolePrompt.slice(0, 4000)}`;
}

function publicSettings(row: ProviderRow | undefined) {
  const config = row ? readProviderConfig(row) : undefined;
  return {
    configured: Boolean(config), enabled: config?.enabled ?? false,
    base_url: config?.baseUrl ?? '', model: config?.model ?? '', updated_at: row?.updated_at ?? null,
  };
}

function readProviderConfig(row: ProviderRow): ProviderConfig {
  try { return JSON.parse(decryptAiReplySecret(row.settings_enc)) as ProviderConfig; }
  catch { throw new OperatorError(503, 'AI_REPLY_SETTINGS_UNAVAILABLE', 'Konfigurasi provider AI tidak dapat dibuka.'); }
}

export async function getAiReplySettings(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    const row = (await client.query<ProviderRow>(
      'SELECT settings_enc,updated_at FROM ai_reply_provider_settings WHERE singleton=true',
    )).rows[0];
    await writeAudit(client, actor, 'system_ai_reply.settings_view', 'ai_reply_provider_settings', '00000000-0000-4000-8000-000000000001', 'Pengaturan provider balasan AI', {}, requestId, clientIp);
    return publicSettings(row);
  });
}

export async function saveAiReplySettings(db: Pool, actor: Actor, requestId: string, clientIp: string,
  input: { baseUrl: string; model: string; apiKey?: string; enabled: boolean }) {
  let baseUrl: string;
  try { baseUrl = normalizeAiReplyBaseUrl(input.baseUrl.trim()); }
  catch { throw new OperatorError(400, 'VALIDATION_ERROR', 'URL provider harus HTTPS dan tidak boleh berisi kredensial.'); }
  const model = input.model.trim();
  if (!model || model.length > 160) throw new OperatorError(400, 'VALIDATION_ERROR', 'Model AI wajib diisi (maksimal 160 karakter).');
  if (input.apiKey !== undefined && input.apiKey.length > 500) throw new OperatorError(400, 'VALIDATION_ERROR', 'API key terlalu panjang.');
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    const prior = (await client.query<ProviderRow>(
      'SELECT settings_enc,updated_at FROM ai_reply_provider_settings WHERE singleton=true FOR UPDATE',
    )).rows[0];
    const suppliedKey = input.apiKey?.trim();
    const priorConfig = prior ? readProviderConfig(prior) : undefined;
    const apiKey = suppliedKey || priorConfig?.apiKey;
    if (!apiKey) throw new OperatorError(400, 'AI_REPLY_API_KEY_REQUIRED', 'API key wajib diisi saat konfigurasi pertama.');
    let encrypted: string;
    try { encrypted = encryptAiReplySecret(JSON.stringify({ baseUrl, model, apiKey, enabled: input.enabled } satisfies ProviderConfig)); }
    catch { throw new OperatorError(503, 'AI_REPLY_ENCRYPTION_UNAVAILABLE', 'Kunci enkripsi AI belum dikonfigurasi di server.'); }
    await client.query(`INSERT INTO ai_reply_provider_settings(singleton,settings_enc,updated_at,updated_by)
      VALUES(true,$1,now(),$2)
      ON CONFLICT(singleton) DO UPDATE SET settings_enc=EXCLUDED.settings_enc,updated_at=now(),updated_by=EXCLUDED.updated_by`, [encrypted, actor.id]);
    await writeAudit(client, actor, 'system_ai_reply.settings_update', 'ai_reply_provider_settings', '00000000-0000-4000-8000-000000000001', 'Pengaturan provider balasan AI', {}, requestId, clientIp);
    return { configured: true, enabled: input.enabled, base_url: baseUrl, model, updated_at: new Date() };
  });
}

/** Internal bot-to-gateway proxy. The bot supplies only a rule and inbound text; prompt and provider key stay server-side. */
export async function generateInternalAiReply(db: Pool, input: { deviceKey: string; ruleId: string; inboundText: string }): Promise<string> {
  const row = (await db.query<{ trigger_type: string; trigger_pattern: string; response_type: string; response_content: string; tenant_id: string }>(
    `SELECT r.trigger_type,r.trigger_pattern,r.response_type,r.response_content,r.tenant_id
     FROM auto_reply_rules r JOIN devices d ON d.device_key=r.device_key AND d.tenant_id=r.tenant_id
     WHERE r.id=$1 AND r.device_key=$2 AND r.is_active=true AND r.response_type IN ('ai','ai_general') AND d.status='online'`,
    [input.ruleId, input.deviceKey],
  )).rows[0];
  if (!row) throw new OperatorError(404, 'AI_REPLY_RULE_NOT_AVAILABLE', 'Aturan AI tidak aktif untuk device ini.');
  const text = input.inboundText.slice(0, 4000);
  const triggered = row.trigger_type === 'all' || (row.trigger_type === 'keyword'
    ? text.toLocaleLowerCase().includes(row.trigger_pattern.toLocaleLowerCase())
    : row.trigger_type === 'regex' && isSafeAutoReplyRegex(row.trigger_pattern) && new RegExp(row.trigger_pattern, 'i').test(text.slice(0, 512)));
  if (!triggered) throw new OperatorError(409, 'AI_REPLY_TRIGGER_NOT_MATCHED', 'Pesan tidak cocok dengan pemicu aturan.');
  const providerRow = (await db.query<ProviderRow>(
    'SELECT settings_enc,updated_at FROM ai_reply_provider_settings WHERE singleton=true',
  )).rows[0];
  if (!providerRow) throw new OperatorError(503, 'AI_REPLY_NOT_CONFIGURED', 'Balasan AI belum dikonfigurasi oleh pemilik sistem.');
  const provider = readProviderConfig(providerRow);
  if (!provider.enabled) throw new OperatorError(503, 'AI_REPLY_NOT_CONFIGURED', 'Balasan AI belum diaktifkan oleh pemilik sistem.');
  let baseUrl: string;
  try { baseUrl = normalizeAiReplyBaseUrl(provider.baseUrl); }
  catch { throw new OperatorError(503, 'AI_REPLY_PROVIDER_UNAVAILABLE', 'Provider balasan AI belum tersedia.'); }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: provider.model, temperature: 0.3, max_tokens: 400, messages: [
        { role: 'system', content: buildAiReplySystemInstruction(row.response_type as 'ai' | 'ai_general', row.response_content) },
        { role: 'user', content: text },
      ] }), signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new OperatorError(503, 'AI_REPLY_PROVIDER_UNAVAILABLE', 'Provider balasan AI tidak merespons.'); }
  if (!response.ok) throw new OperatorError(503, 'AI_REPLY_PROVIDER_UNAVAILABLE', 'Provider balasan AI menolak permintaan.');
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new OperatorError(503, 'AI_REPLY_PROVIDER_UNAVAILABLE', 'Provider balasan AI tidak memberikan jawaban.');
  return content.trim().slice(0, 4096);
}
