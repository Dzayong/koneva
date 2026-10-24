"use client";

import { useRef } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";

const SIGNUP_TUTORIAL = {
  title: "Buat akun KONEVA",
  src: "/media/tutorial-daftar-biasa.webm",
  poster: "/media/tutorial-daftar-biasa-poster.jpg",
  description: "Alur pendaftaran reguler: isi data akun, verifikasi nomor WhatsApp, lalu masuk ke dashboard.",
} as const;

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
  const videoBox = useRef<HTMLDivElement>(null);
  // The 3 MB clip is not fetched until the tour is about to scroll into view (phones on mobile data).
  const near = useInView(videoBox, { once: true, margin: "300px" });
  return (
    <div className="space-y-6">
      <Reveal from="pop">
      <Frame>
        <div className="space-y-3 p-4 sm:p-5">
          <p className="font-medium">{SIGNUP_TUTORIAL.title}</p>
          <p className="text-sm text-muted-foreground">{SIGNUP_TUTORIAL.description}</p>
          <p className="text-xs text-muted-foreground">Rekaman memakai data contoh dan simulasi lokal. Tidak ada akun atau OTP sungguhan yang dibuat.</p>
        </div>
        {/* The actual signup screen recordings stay muted and inline on mobile. */}
        {/* suppressHydrationWarning: `near` (IntersectionObserver) and `reduce` (prefers-reduced-motion) are both
            unknowable during SSR (server always renders as if neither), so a client where the box is already in
            view or reduced-motion is on legitimately gets a different `src`/`autoPlay`/`controls` on first paint. */}
        <div ref={videoBox}><video suppressHydrationWarning className="aspect-video w-full bg-muted" {...(near ? { src: SIGNUP_TUTORIAL.src } : {})} poster={SIGNUP_TUTORIAL.poster}
          autoPlay={!reduce} muted loop playsInline preload="none" controls={Boolean(reduce)}
          aria-label={`Rekaman layar: ${SIGNUP_TUTORIAL.title}`} /></div>
      </Frame>
      </Reveal>
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border bg-card/80 p-4 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">Panduan pendaftaran lengkap tersedia di artikel bantuan.</p>
        <Button asChild variant="outline" size="sm"><Link href="/panduan/daftar-dan-klaim-voucher">Buka artikel panduan <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
      </div>
    </div>
  );
}
