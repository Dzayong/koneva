import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg,#0a1224 0%,#14285a 60%,#0e7490 120%)", color: "#f2f5fc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#0f2d6e" />
            <path d="M15.5 11.5v25M15.5 24 33 11.5M15.5 24 33 36.5" stroke="#fff" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="33" cy="11.5" r="4.3" fill="#22d3ee" />
            <circle cx="33" cy="36.5" r="4.3" fill="#22d3ee" />
            <circle cx="15.5" cy="24" r="3.4" fill="#fff" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 8 }}>KONEVA</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Kirim WhatsApp lewat API, dengan nomor Anda sendiri.</div>
          <div style={{ fontSize: 30, color: "#a9b7d6" }}>Pemanasan bertahap · jeda seperti manusia · skor kesiapan · webhook bertanda tangan</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#67e8f9" }}>Coba gratis 14 hari, tanpa kartu kredit</div>
      </div>
    ),
    size,
  );
}
