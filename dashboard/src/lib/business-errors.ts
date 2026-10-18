import { apiFailure } from "./errors";

const TEXT: Record<string, string> = {
  NOT_BUSINESS: "Nomor ini WhatsApp biasa. Bagian profil bisnis hanya untuk device yang terdaftar di WhatsApp Business.",
  DEVICE_NOT_RESPONDING: "Nomor tidak menjawab. Pastikan nomor sedang online, lalu coba lagi.",
  NOT_CONNECTED: "Nomor sedang tidak tersambung. Sambungkan dulu, lalu coba lagi.",
  DEVICE_BANNED: "Nomor ini diblokir WhatsApp, jadi tidak bisa dipakai.",
  STATUS_LIMIT: "Batas status hari ini sudah tercapai (maksimal 3 per device per hari). Coba lagi besok.",
  NO_AUDIENCE: "Tidak ada kontak yang cocok dengan pilihan audiens status ini.",
  AUDIENCE_TOO_LARGE: "Audiens status melebihi batas 500 kontak. Kecilkan audiens atau gunakan pilihan kontak tertentu.",
  WA_TIMEOUT: "WhatsApp tidak menjawab dalam waktu wajar. Pastikan device online, lalu coba lagi.",
  INTERRUPTED: "Terhenti karena nomor dimulai ulang. Buat ulang bila perlu.",
};

/** Plain-language text for the failures a customer can actually run into on these screens. */
export function businessErrorText(error: unknown): string {
  const f = apiFailure(error);
  return (f.code && TEXT[f.code]) || f.message;
}

/** Failures stored on a command look like "CODE: message". */
export function commandErrorText(error: string | null): string {
  const match = /^([A-Z_]+): ([\s\S]*)$/.exec(error ?? "");
  return (match?.[1] && TEXT[match[1]]) || match?.[2] || error || "Gagal";
}
