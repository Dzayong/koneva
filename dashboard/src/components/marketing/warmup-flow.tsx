"use client";

import { useState } from "react";
import { motion, useReducedMotion, useIsomorphicLayoutEffect } from "framer-motion";
import { MessageCircleReply, Image as ImageIcon, Sprout } from "lucide-react";

// Mirrors the real warm-up stages in src/bot-container/anti-ban.ts.
const STAGES = [
  { days: "Hari 1–2", limit: 5, note: "Hanya membalas orang yang lebih dulu menulis", icon: MessageCircleReply },
  { days: "Hari 3–4", limit: 10, note: "Pesan pertama ke kontak baru mulai boleh", icon: Sprout },
  { days: "Hari 5–7", limit: 20, note: "Media mulai boleh dikirim", icon: ImageIcon },
  { days: "Hari 8+", limit: 50, note: "Batas harian normal", icon: Sprout },
] as const;

export function WarmupFlow() {
  // framer-motion's useReducedMotion() reads window.matchMedia synchronously on the client's first render
  // (motion-dom's initPrefersReducedMotion runs during render, not in an effect), while SSR always returns
  // null. On a client whose OS has reduced motion on, that makes the very first hydration pass already
  // disagree with the SSR-rendered opacity/transform/width -- a real hydration mismatch, not a value that
  // only diverges later. `mounted` stays false (both server and this first client render agree, since the
  // initial state is a literal, not a browser read) until useIsomorphicLayoutEffect flips it just before the
  // browser paints -- before whileInView's IntersectionObserver can fire, including when the page loads
  // already scrolled to this section (e.g. a direct #harga link). So the first render always matches SSR
  // exactly (no suppressHydrationWarning needed), and the real preference still applies before any entrance
  // animation is ever visible.
  const [mounted, setMounted] = useState(false);
  const prefersReduced = useReducedMotion();
  useIsomorphicLayoutEffect(() => setMounted(true), []);
  const reduce = mounted && prefersReduced;
  return (
    <div className="relative grid gap-4 md:grid-cols-4">
      <div aria-hidden className="absolute top-[52px] right-8 left-8 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
      {STAGES.map((s, i) => (
        <motion.div
          key={s.days}
          initial={reduce ? false : { opacity: 0, y: 32, scale: 0.95 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: "0px 0px -12% 0px" }}
          transition={{ duration: 0.7, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-2xl border bg-card p-5 shadow-card"
        >
          <div className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-background">
            <s.icon className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{s.days}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{s.limit}<span className="ml-1 text-sm font-normal text-muted-foreground">pesan/hari</span></p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={reduce ? false : { width: 0 }}
              whileInView={{ width: `${(s.limit / 50) * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.3 + i * 0.12, ease: "easeOut" }}
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{s.note}</p>
        </motion.div>
      ))}
    </div>
  );
}
