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
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg,#2563eb,#06b6d4)" }} />
          <div style={{ fontSize: 40, fontWeight: 700 }}>WA Gateway</div>
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
