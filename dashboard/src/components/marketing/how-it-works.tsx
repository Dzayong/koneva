"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Smartphone, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: KeyRound, title: "Buat akun", text: "Daftar dengan email dan langsung mendapat workspace uji coba 14 hari. Dashboard menunjukkan langkah berikutnya.", img: "/media/ringkasan.png" },
  { icon: Smartphone, title: "Sambungkan nomor", text: "Tambahkan nomor lalu pindai kode QR dari WhatsApp, seperti membuka WhatsApp Web.", img: "/media/sambungkan-qr.png" },
  { icon: Zap, title: "Kirim pesan", text: "Salin kode contoh, tempel kunci API, kirim. Status antre, terkirim, dan dibaca muncul langsung.", img: "/media/mulai-cepat.png" },
] as const;

/** Sticky screenshot on the left that follows whichever step is centred on the right. */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { rootMargin: "-40% 0px -40% 0px" },
    );
    refs.current.forEach((r) => r && observer.observe(r));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid gap-10 md:grid-cols-2 md:gap-16">
      <div className="relative hidden md:block">
        <div className="sticky top-28 overflow-hidden rounded-2xl border bg-card shadow-elevated">
          <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" />
          </div>
          <div className="relative aspect-[16/9]">
            <AnimatePresence mode="popLayout">
              <motion.img key={STEPS[active]!.img} src={STEPS[active]!.img} alt={STEPS[active]!.title}
                initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }} className="absolute inset-0 h-full w-full object-cover object-top" />
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div>
        {STEPS.map((s, i) => (
          <div key={s.title} ref={(el) => { refs.current[i] = el; }} data-index={i} className="flex min-h-[46vh] flex-col justify-center py-8 md:min-h-[62vh]">
            <span className={cn("font-display text-6xl transition-colors duration-300", active === i ? "text-primary" : "text-muted-foreground/40")}>0{i + 1}</span>
            <h3 className="font-display mt-3 flex items-center gap-2 text-3xl"><s.icon className="h-6 w-6 text-primary" />{s.title}</h3>
            <p className="mt-3 max-w-md text-lg text-muted-foreground">{s.text}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.img} alt={s.title} loading="lazy" className="mt-6 rounded-xl border shadow-card md:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}
