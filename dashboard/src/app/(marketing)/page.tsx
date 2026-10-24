import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { FAQ } from "@/components/marketing/faq-data";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: SITE.title },
  description: SITE.description,
  alternates: { canonical: "/" },
  keywords: ["API WhatsApp", "WhatsApp API Indonesia", "kirim OTP WhatsApp", "notifikasi WhatsApp", "WhatsApp gateway", "webhook WhatsApp"],
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
        "Persetujuan penerima, opt-out, dan batas pengiriman",
        "Skor kesiapan nomor dan deteksi nomor bermasalah",
        "Webhook bertanda tangan HMAC",
        "Prioritas urgent untuk OTP",
        "Dashboard tim dengan peran dan log aktivitas",
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
