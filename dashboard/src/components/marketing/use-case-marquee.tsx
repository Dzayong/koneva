"use client";

import { useState } from "react";
import { BellRing, Bot, CalendarClock, KeyRound, Package, Pause, Play, ReceiptText } from "lucide-react";

const ITEMS = [
  { icon: KeyRound, label: "Kode OTP" },
  { icon: Package, label: "Status pesanan" },
  { icon: CalendarClock, label: "Pengingat jadwal" },
  { icon: ReceiptText, label: "Tagihan" },
  { icon: Bot, label: "Balasan otomatis" },
  { icon: BellRing, label: "Notifikasi sistem" },
];

/** CSS ticker; the list is doubled so the -50% translate loops seamlessly. Pausable for accessibility. */
export function UseCaseMarquee() {
  const [paused, setPaused] = useState(false);
  return (
    <div className="marquee relative flex items-center border-y" data-paused={paused} aria-label="Untuk apa saja">
      <div className="min-w-0 flex-1 overflow-hidden py-4 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div className="marquee-track flex w-max gap-12">
          {[...ITEMS, ...ITEMS, ...ITEMS, ...ITEMS].map((it, i) => (
            <span key={i} aria-hidden={i >= ITEMS.length} className="flex items-center gap-2 text-base font-medium whitespace-nowrap text-muted-foreground">
              <it.icon className="h-4 w-4 text-primary" />{it.label}
            </span>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Putar teks berjalan" : "Jeda teks berjalan"}
        className="mr-4 shrink-0 rounded-full border p-1.5 text-muted-foreground hover:text-foreground">
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
