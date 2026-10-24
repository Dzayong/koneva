/** Plain-language reasons for the codes the API stores in a message's error_message. */
const REASONS: Record<string, string> = {
  outside_working_hours: "Di luar jam kerja workspace. Pesan akan dicoba lagi saat jam kerja dibuka.",
  rate_limit_per_minute: "Terlalu banyak pesan dalam satu menit. Coba lagi sebentar.",
  resting: "Nomor sedang istirahat setelah mengirim banyak pesan. Pesan akan dicoba lagi otomatis.",
  device_paused: "Nomor sedang dijeda. Lanjutkan nomor lalu kirim ulang.",
  device_banned: "WhatsApp menolak nomor ini. Pengiriman dihentikan. Sambungkan device lain.",
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
