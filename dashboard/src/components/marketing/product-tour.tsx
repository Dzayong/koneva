"use client";

import { useReducedMotion } from "framer-motion";
import { Reveal } from "./reveal";
import { cn } from "@/lib/utils";

const SHOTS = [
  { src: "/media/ringkasan.png", title: "Panduan langkah demi langkah", text: "Dashboard menunjukkan satu langkah berikutnya, tidak membiarkan Anda bingung mulai dari mana.", className: "md:col-span-2" },
  { src: "/media/sambungkan-qr.png", title: "Sambungkan dengan pindai QR", text: "Seperti WhatsApp Web. Tanpa instalasi.", className: "" },
  { src: "/media/webhook-kode.png", title: "Webhook dengan kode siap salin", text: "Contoh Node.js, Python, dan PHP. Ada tombol kirim tes.", className: "" },
  { src: "/media/tagihan.png", title: "Paket dan tagihan yang jelas", text: "Sisa kuota, masa aktif, dan cara bayar di satu halaman.", className: "md:col-span-2" },
] as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-elevated">
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" />
      </div>
      {children}
    </div>
  );
}

export function ProductTour() {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-6">
      <Reveal from="pop">
      <Frame>
        {/* Muted, looping and inline so it plays without sound or a fullscreen takeover on phones. */}
        <video className="aspect-video w-full bg-muted" src="/media/alur-dashboard.webm" poster="/media/ringkasan.png"
          autoPlay={!reduce} muted loop playsInline preload="metadata" controls={Boolean(reduce)}
          aria-label="Rekaman layar: mendaftar, menambah nomor, memasang webhook" />
      </Frame>
      </Reveal>
      <div className="grid gap-6 md:grid-cols-3">
        {SHOTS.map((s, i) => (
          <Reveal key={s.src} as="figure" from={i % 2 === 0 ? "left" : "right"} delay={(i % 2) * 0.08} className={cn("space-y-3", s.className)}>
            <Frame>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.title} loading="lazy" className="w-full" />
            </Frame>
            <figcaption><p className="font-medium">{s.title}</p><p className="text-sm text-muted-foreground">{s.text}</p></figcaption>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
