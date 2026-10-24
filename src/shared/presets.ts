import { unit } from './persona';

// Presets are starting points named after what a number is used for. Each number still gets
// small, seed-derived variations, so two numbers on the same preset do not share one rhythm.

export const PRESET_IDS = ['customer_service', 'notifications', 'careful_marketing'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface PresetDefinition {
  id: PresetId;
  label: string;
  description: string;
  always_on: boolean;
  wake_hour: number;
  sleep_hour: number;
  delay_min_ms: number;
  delay_max_ms: number;
  burst_size: number;
  rest_min_ms: number;
  rest_max_ms: number;
  typing_ms_per_char: number;
  notes: string[];
}

export const PRESETS: Record<PresetId, PresetDefinition> = {
  customer_service: {
    id: 'customer_service', label: 'Layanan pelanggan',
    description: 'Membalas pelanggan kapan saja, dengan jeda seperti orang yang membaca dulu sebelum menjawab.',
    always_on: true, wake_hour: 6, sleep_hour: 23,
    delay_min_ms: 5_000, delay_max_ms: 60_000, burst_size: 15, rest_min_ms: 240_000, rest_max_ms: 480_000, typing_ms_per_char: 55,
    notes: ['Aktif 24 jam.', 'Jeda acak 5 sampai 60 detik per balasan.'],
  },
  notifications: {
    id: 'notifications', label: 'Notifikasi dan pengingat',
    description: 'Pesan cepat untuk pengingat dan pemberitahuan. Jeda pendek, rentetan panjang.',
    always_on: true, wake_hour: 6, sleep_hour: 23,
    delay_min_ms: 1_000, delay_max_ms: 5_000, burst_size: 30, rest_min_ms: 90_000, rest_max_ms: 180_000, typing_ms_per_char: 35,
    notes: [
      'Untuk OTP kirim dengan priority "urgent": tanpa jeda sama sekali.',
      'Pesan bertemplat ke banyak nomor asing paling mudah dianggap otomatis.',
    ],
  },
  careful_marketing: {
    id: 'careful_marketing', label: 'Pemasaran hati-hati',
    description: 'Hanya jam kerja, jeda panjang, sering istirahat. Untuk pesan ke kontak yang sudah setuju.',
    always_on: false, wake_hour: 8, sleep_hour: 20,
    delay_min_ms: 20_000, delay_max_ms: 90_000, burst_size: 8, rest_min_ms: 360_000, rest_max_ms: 900_000, typing_ms_per_char: 65,
    notes: ['Kirim hanya ke kontak yang sudah setuju (opt-in).', 'Aktif sekitar 08.00 sampai 20.00.'],
  },
};

export interface PresetValues {
  alwaysOn: boolean; wakeHour: number; sleepHour: number; delayMinMs: number; delayMaxMs: number;
  burstSize: number; restMinMs: number; restMaxMs: number; typingMsPerChar: number;
}

const around = (seed: string, label: string, base: number, spread: number): number =>
  base * (1 - spread + 2 * spread * unit(seed, `preset:${label}`));

/** The preset's values with this number's own small variations, all inside the persona's valid ranges. */
export function presetValuesFor(id: PresetId, seed: string): PresetValues {
  const p = PRESETS[id];
  const delayMinMs = Math.max(1_000, Math.round(around(seed, 'dmin', p.delay_min_ms, 0.12) / 100) * 100);
  const delayMaxMs = Math.max(delayMinMs, Math.round(around(seed, 'dmax', p.delay_max_ms, 0.12) / 100) * 100);
  const restMinMs = Math.max(60_000, Math.round(around(seed, 'rmin', p.rest_min_ms, 0.15) / 1_000) * 1_000);
  const restMaxMs = Math.max(restMinMs, Math.round(around(seed, 'rmax', p.rest_max_ms, 0.15) / 1_000) * 1_000);
  const shift = (label: string): number => Math.round((unit(seed, `preset:${label}`) - 0.5) * 0.5 * 4) / 4;
  return {
    alwaysOn: p.always_on,
    wakeHour: Math.max(0, p.wake_hour + shift('wake')),
    sleepHour: Math.min(24, p.sleep_hour + shift('sleep')),
    delayMinMs, delayMaxMs,
    burstSize: Math.min(60, Math.max(2, Math.round(p.burst_size + (unit(seed, 'preset:burst') - 0.5) * 4))),
    restMinMs, restMaxMs,
    typingMsPerChar: Math.max(20, Math.round(around(seed, 'type', p.typing_ms_per_char, 0.1))),
  };
}

export const isPresetId = (value: string): value is PresetId => (PRESET_IDS as readonly string[]).includes(value);
