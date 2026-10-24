import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { FAQ } from "@/components/marketing/faq-data";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: SITE.title },
  description: SITE.description,
  alternates: { canonical: "/" },
  keywords: ["WhatsApp API Indonesia", "API WhatsApp untuk developer", "inbox CS WhatsApp", "shared inbox WhatsApp", "WhatsApp API untuk bisnis", "WhatsApp API untuk mahasiswa", "webhook WhatsApp"],
  openGraph: { type: "website", url: "/", siteName: SITE.name, title: SITE.title, description: SITE.description, locale: SITE.locale, images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SITE.title }] },
  twitter: { card: "summary_large_image", title: SITE.title, description: SITE.description, images: ["/opengraph-image"] },
};

// Structured data for search engines and AI assistants. FAQ text is the same source as the visible FAQ.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE.url}/#org`, name: SITE.name, url: SITE.url },
    { "@type": "WebSite", "@id": `${SITE.url}/#site`, url: SITE.url, name: SITE.name, inLanguage: "id-ID", publisher: { "@id": `${SITE.url}/#org` } },
    {
      "@type": "SoftwareApplication",
      name: SITE.name,
      url: SITE.url,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "id-ID",
      description: SITE.description,
      featureList: [
        "Kirim dan terima pesan WhatsApp lewat REST API dengan nomor sendiri",
        "Inbox bersama untuk tim customer service membaca dan membalas percakapan dari device terhubung",
        "Kelola beberapa device WhatsApp dalam satu workspace",
        "Saldo prabayar dengan biaya berdasarkan pesan berhasil",
        "Webhook bertanda tangan HMAC dan status pesan",
        "Peran anggota tim dan izin akses workspace",
      ],
      publisher: { "@id": `${SITE.url}/#org` },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <LandingPage />
    </>
  );
}
