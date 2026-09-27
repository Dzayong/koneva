"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";

// Weights match src/shared/readiness.ts. Values are an example, not real data.
const FACTORS = [
  { name: "Stabilitas koneksi", weight: 15, value: 14 },
  { name: "Usia nomor", weight: 20, value: 16 },
  { name: "Pengiriman", weight: 25, value: 22 },
  { name: "Interaksi dua arah", weight: 20, value: 14 },
  { name: "Persetujuan penerima", weight: 20, value: 18 },
];
const SCORE = FACTORS.reduce((a, f) => a + f.value, 0);
const R = 54;
const C = 2 * Math.PI * R;

function CountUp({ to, reduce }: { to: number; reduce: boolean | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, to, { duration: 1.4, ease: "easeOut", onUpdate: (v) => setN(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduce, to]);
  // suppressHydrationWarning: `n` can legitimately differ from the server's `0` on a client whose prefers-reduced-motion
  // setting makes `reduce` true on first paint (SSR always assumes false; see Reveal for the same reason).
  return <span ref={ref} suppressHydrationWarning>{n}</span>;
}

export function ReadinessRing() {
  const reduce = useReducedMotion();
  return (
    <div className="grid items-center gap-8 rounded-3xl border bg-card p-6 shadow-card md:grid-cols-[220px_1fr] md:p-10">
      <div className="relative mx-auto h-[200px] w-[200px]">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" role="img" aria-label={`Contoh skor kesiapan ${SCORE} dari 100`}>
          <circle cx="64" cy="64" r={R} fill="none" strokeWidth="10" className="stroke-muted" />
          <motion.circle
            suppressHydrationWarning
            cx="64" cy="64" r={R} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-primary"
            strokeDasharray={C}
            initial={{ strokeDashoffset: reduce ? C * (1 - SCORE / 100) : C }}
            whileInView={{ strokeDashoffset: C * (1 - SCORE / 100) }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-semibold tracking-tight tabular-nums"><CountUp to={SCORE} reduce={reduce} /></span>
          <span className="text-xs text-muted-foreground">dari 100 · contoh</span>
        </div>
      </div>
      <div className="space-y-3">
        {FACTORS.map((f, i) => (
          <div key={f.name}>
            <div className="flex justify-between text-sm"><span>{f.name}</span><span className="text-muted-foreground">{f.value}/{f.weight}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                suppressHydrationWarning
                className="h-full rounded-full bg-primary/80"
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${(f.value / f.weight) * 100}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.2 + i * 0.1, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
