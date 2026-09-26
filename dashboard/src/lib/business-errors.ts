import { apiFailure } from "./errors";

const TEXT: Record<string, string> = {
  NOT_BUSINESS: "Nomor ini WhatsApp biasa. Fitur ini hanya untuk nomor yang terdaftar di WhatsApp Business.",
  DEVICE_NOT_RESPONDING: "Nomor tidak menjawab. Pastikan nomor sedang online, lalu coba lagi.",
  NOT_CONNECTED: "Nomor sedang tidak tersambung. Sambungkan dulu, lalu coba lagi.",
  DEVICE_BANNED: "Nomor ini diblokir WhatsApp, jadi tidak bisa dipakai.",
  STATUS_LIMIT: "Batas status hari ini sudah tercapai (maksimal 3 per nomor per hari). Coba lagi besok.",
  NO_AUDIENCE: "Belum ada kontak yang bisa melihat status ini. Saling berkirim pesan dulu, atau isi daftar nomor.",
  CATALOG_TIMEOUT: "WhatsApp tidak menjawab permintaan katalog dari perangkat tertaut. Katalog Anda tetap aman dan bisa dikelola di aplikasi WhatsApp Business di HP. Ini keterbatasan dari WhatsApp, bukan kesalahan data Anda.",
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
