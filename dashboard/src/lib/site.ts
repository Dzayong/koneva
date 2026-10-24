/** Public identity used by metadata, sitemap, robots and structured data. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE = {
  name: "KONEVA",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:13000").replace(/\/$/, ""),
  title: "KONEVA — WhatsApp API dan inbox CS untuk tim",
  description:
    "Hubungkan aplikasi ke WhatsApp lewat REST API dan kelola percakapan pelanggan bersama tim CS dalam satu inbox. Gunakan nomor sendiri dan saldo prabayar; risiko pembatasan WhatsApp tetap berlaku.",
  locale: "id_ID",
} as const;
