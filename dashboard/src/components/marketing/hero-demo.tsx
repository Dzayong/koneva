"use client";

import { useEffect, useState } from "react";
import { Check, CheckCheck, Clock } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const CURL = `curl -X POST https://api.domain-anda.com/api/v1/message/send \\
  -H "Authorization: Bearer wgk_••••••••" \\
  -d '{"to":"628123456789",
       "content":"Kode OTP Anda: 482913",
       "priority":"urgent"}'`;

const TICK_MS = 30;
const TYPED = CURL.length; // one character per tick
const QUEUED_AT = TYPED + 14;
const SENT_AT = QUEUED_AT + 30;
const READ_AT = SENT_AT + 36;
const LOOP_AT = READ_AT + 110;

/** Everything derives from one counter, so the demo replays as a loop and needs no per-step timers. */
export function HeroDemo() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setTick((t) => (t + 1 >= LOOP_AT ? 0 : t + 1)), TICK_MS);
    return () => clearInterval(id);
  }, [reduce]);
  const t = reduce ? READ_AT : tick;

  const typed = CURL.slice(0, Math.min(t, TYPED));
  const status = t >= READ_AT ? "read" : t >= SENT_AT ? "sent" : t >= QUEUED_AT ? "queued" : null;

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-primary/10 blur-2xl" />
      {/* Terminal */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-elevated">
        <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" /><span className="h-2.5 w-2.5 rounded-full bg-slate-700" /><span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="ml-3 font-mono text-xs text-slate-500">terminal</span>
        </div>
        <pre aria-label="Contoh permintaan API" className="min-h-[148px] overflow-hidden px-4 py-4 font-mono text-[12.5px] leading-6 whitespace-pre-wrap text-slate-200">
          <span className="text-emerald-400">$ </span>{typed}
          {t < TYPED && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-slate-300" />}
        </pre>
        <div className={cn("border-t border-slate-800 px-4 py-3 font-mono text-[12.5px] transition-opacity duration-300", status ? "opacity-100" : "opacity-0")}>
          <span className="text-slate-500">202 </span><span className="text-emerald-400">{`{ "status": "${status === "queued" ? "queued" : "accepted"}" }`}</span>
        </div>
      </div>

      {/* Phone-style message card */}
      <div className="relative -mt-2 ml-auto w-[88%] rounded-2xl border bg-card p-4 shadow-elevated">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">PL</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Pelanggan</p>
            <p className="text-xs text-muted-foreground">+62 812-3456-789</p>
          </div>
        </div>
        <div className="mt-3 flex min-h-[64px] justify-end">
          <div className={cn("max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/10 px-3.5 py-2.5 text-sm transition-all duration-300", status ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")}>
            Kode OTP Anda: <span className="font-semibold">482913</span>
            <span className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
              {status === "queued" && <><Clock className="h-3 w-3" />antre</>}
              {status === "sent" && <><Check className="h-3.5 w-3.5" />terkirim</>}
              {status === "read" && <><CheckCheck className="h-3.5 w-3.5 text-sky-500" />dibaca</>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
