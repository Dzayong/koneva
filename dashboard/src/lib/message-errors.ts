/** Plain-language reasons for the codes the API stores in a message's error_message. */
const REASONS: Record<string, string> = {
  outside_sending_window: "Di luar jam aktif nomor ini. Pesan menunggu sampai nomor aktif lagi.",
  daily_cap_reached: "Batas kirim harian nomor ini sudah tercapai. Nomor baru dibatasi bertahap selama 8 hari pertama.",
  rate_limit_per_minute: "Terlalu banyak pesan dalam satu menit. Coba lagi sebentar.",
  resting: "Nomor sedang istirahat setelah mengirim banyak pesan. Pesan akan dicoba lagi otomatis.",
  device_paused: "Nomor sedang dijeda. Lanjutkan nomor lalu kirim ulang.",
  device_banned: "WhatsApp menolak nomor ini. Pengiriman dihentikan. Sambungkan device lain.",
  health_score_too_low: "Kesiapan nomor terlalu rendah, pengiriman ditahan untuk melindungi nomor.",
  proactive_not_allowed_in_warmup: "Nomor baru belum boleh memulai percakapan selama 2 hari pertama. Pesan menunggu sampai hari ke-3, atau bisa dikirim lebih cepat jika penerima menghubungi Anda lebih dulu.",
  media_not_allowed_in_warmup: "Nomor baru belum boleh mengirim media.",
  queue_expired: "Pesan tidak dikirim karena terlalu lama menunggu di antrean (batas saat ini 15 menit). Periksa koneksi dan status nomor, lalu pilih Kirim ulang jika pesan masih perlu dikirim.",
  content_rejected: "Isi pesan ditolak filter spam.",
  recipient_opted_out: "Penerima pernah meminta berhenti, jadi pesan proaktif tidak dikirim.",
  lost_in_queue: "Pesan hilang dari antrean saat sistem dimulai ulang. Kirim ulang bila perlu.",
  delivery_uncertain: "WhatsApp belum memberi konfirmasi. Pesan mungkin sudah diterima; periksa chat sebelum mencoba kirim lagi.",
  "WhatsApp socket is not connected": "Nomor sedang tidak tersambung ke WhatsApp.",
};

export function messageErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASONS[code] ?? code;
}
