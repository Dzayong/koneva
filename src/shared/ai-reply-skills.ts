export const AI_REPLY_SKILLS = {
  customer_service: {
    name: 'CS ramah',
    description: 'Menjawab pertanyaan pelanggan dengan ramah dan jelas.',
    instructions: 'Tanggapi kebutuhan pelanggan dengan sopan dan empatik. Jawab langsung, ajukan satu pertanyaan singkat bila konteks belum cukup, dan jangan mengaku sudah melakukan tindakan yang belum dilakukan.',
  },
  shop_assistant: {
    name: 'Asisten toko',
    description: 'Membantu pelanggan memahami produk dan langkah pemesanan.',
    instructions: 'Bantu pelanggan memahami produk, cara pemesanan, dan langkah berikutnya berdasarkan fakta workspace yang diberikan. Jangan mengarang stok, harga, diskon, atau janji pengiriman.',
  },
  faq_helper: {
    name: 'Penjawab FAQ',
    description: 'Menjawab berdasarkan informasi usaha yang diisi Owner.',
    instructions: 'Cari jawaban hanya dari informasi usaha yang disediakan. Jika jawabannya belum tersedia, sampaikan dengan jujur dan tawarkan untuk menghubungkan pelanggan dengan CS.',
  },
  research_context: {
    name: 'Analisis informasi',
    description: 'Menganalisis konteks yang diberikan; tidak mencari internet.',
    instructions: 'Analisis informasi yang tersedia pada pesan dan fakta workspace. Jangan mengaku mencari internet atau sumber eksternal. Bedakan fakta dari dugaan dan tanyakan bila bukti tidak cukup.',
  },
} as const;

export type AiReplySkillId = keyof typeof AI_REPLY_SKILLS;

export interface AiReplyRuleConfig {
  skill_ids: AiReplySkillId[];
  variables: Record<string, string>;
}

export const EMPTY_AI_REPLY_RULE_CONFIG: AiReplyRuleConfig = { skill_ids: [], variables: {} };

export function normalizeAiReplyRuleConfig(value: unknown): AiReplyRuleConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_AI_REPLY_RULE_CONFIG };
  const record = value as Record<string, unknown>;
  const skillIds = Array.isArray(record.skill_ids)
    ? record.skill_ids.filter((id): id is AiReplySkillId => typeof id === 'string' && id in AI_REPLY_SKILLS)
    : [];
  const variables: Record<string, string> = {};
  if (record.variables && typeof record.variables === 'object' && !Array.isArray(record.variables)) {
    for (const [key, raw] of Object.entries(record.variables as Record<string, unknown>).slice(0, 20)) {
      if (/^[a-z][a-z0-9_]{0,39}$/i.test(key) && typeof raw === 'string') variables[key] = raw.slice(0, 1000);
    }
  }
  return { skill_ids: [...new Set(skillIds)], variables };
}
