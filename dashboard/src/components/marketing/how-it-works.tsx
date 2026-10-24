"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, MessagesSquare, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

const STEPS = [
  { icon: MessagesSquare, title: "Layani pelanggan bersama", text: "Pemilik menghubungkan nomor. CS memilih device, membaca konteks chat, lalu membalas dari inbox bersama.", img: "/media/marketing-inbox.jpg" },
  { icon: Wallet, title: "Isi saldo saat dibutuhkan", text: "Lihat saldo tersedia, biaya tertahan, tarif per pesan berhasil, dan riwayat top up dari satu halaman.", img: "/media/marketing-saldo.jpg" },
  { icon: Code2, title: "Hubungkan aplikasi lewat API", text: "Developer mulai dari dokumentasi, membuat kunci API, lalu memantau status pesan dan webhook.", img: "/media/marketing-docs.jpg" },
] as const;

/** Current product screenshots follow the story, so customers can see actual workflows instead of old mockups. */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);

  // The active step is the one whose text block is nearest the middle of the screen. (An IntersectionObserver
  // band switched the picture as soon as the next block's top edge entered it, while its text was still far below.)
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      let bestDistance = Infinity;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - mid);
        if (distance < bestDistance) { bestDistance = distance; best = i; }
      });
      setActive(best);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); if (frame) cancelAnimationFrame(frame); };
  }, []);

  return (
    <div className="grid gap-10 md:grid-cols-2 md:gap-16">
      <div className="relative hidden md:block">
        <div className="sticky top-28 overflow-hidden rounded-2xl border bg-card shadow-elevated">
          <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" />
          </div>
          {/* All three are mounted up front and cross-faded, so nothing is ever unmounted, blank, or waiting on a fetch. */}
          <div className="relative aspect-[16/9] bg-muted">
            {STEPS.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s.img} src={s.img} alt={s.title} width={1280} height={720} decoding="async"
                className={cn("absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500", active === i ? "opacity-100" : "opacity-0")}
                aria-hidden={active !== i} />
            ))}
          </div>
        </div>
      </div>
      <div>
        {STEPS.map((s, i) => (
          <div key={s.title} ref={(el) => { refs.current[i] = el; }} data-index={i} className="flex min-h-[46vh] flex-col justify-center py-8 md:min-h-[62vh]">
            <Reveal from="right">
            <span className={cn("font-display text-6xl transition-colors duration-300", active === i ? "text-primary" : "text-muted-foreground/40")}>0{i + 1}</span>
            <h3 className="font-display mt-3 flex items-center gap-2 text-3xl"><s.icon className="h-6 w-6 text-primary" />{s.title}</h3>
            <p className="mt-3 max-w-md text-lg text-muted-foreground">{s.text}</p>
            </Reveal>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.img} alt={s.title} loading="lazy" className="mt-6 rounded-xl border shadow-card md:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}
