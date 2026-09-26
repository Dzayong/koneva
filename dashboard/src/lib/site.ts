/** Public identity used by metadata, sitemap, robots and structured data. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE = {
  name: "WA Gateway",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:13000").replace(/\/$/, ""),
  title: "WA Gateway: API WhatsApp dengan nomor sendiri, aman dan terukur",
  description:
    "Kirim OTP, notifikasi, dan pesan WhatsApp lewat API dengan nomor Anda sendiri. Pemanasan nomor bertahap, jeda seperti manusia, skor kesiapan, webhook bertanda tangan, dan dashboard tim. Percobaan gratis 14 hari.",
  locale: "id_ID",
} as const;
