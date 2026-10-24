/** Public identity used by metadata, sitemap, robots and structured data. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE = {
  name: "KONEVA",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:13000").replace(/\/$/, ""),
  title: "KONEVA: API WhatsApp dengan nomor sendiri",
  description:
    "Kirim OTP, notifikasi, dan pesan WhatsApp lewat API dengan nomor Anda sendiri. Kelola percakapan, izin penerima, status pesan, dan webhook dari satu dashboard. Risiko pembatasan WhatsApp tetap berlaku.",
  locale: "id_ID",
} as const;
