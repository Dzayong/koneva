import { BellRing, Bot, CalendarClock, KeyRound, Package, ReceiptText } from "lucide-react";

const ITEMS = [
  { icon: KeyRound, label: "Kode OTP" },
  { icon: Package, label: "Status pesanan" },
  { icon: CalendarClock, label: "Pengingat jadwal" },
  { icon: ReceiptText, label: "Tagihan" },
  { icon: Bot, label: "Balasan otomatis" },
  { icon: BellRing, label: "Notifikasi sistem" },
];

/** Pure CSS ticker; the list is doubled so the -50% translate loops seamlessly. */
export function UseCaseMarquee() {
  return (
    <div className="marquee relative overflow-hidden border-y py-4 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]" aria-label="Untuk apa saja">
      <div className="marquee-track flex w-max gap-10">
        {[...ITEMS, ...ITEMS].map((it, i) => (
          <span key={i} aria-hidden={i >= ITEMS.length} className="flex items-center gap-2 text-sm font-medium whitespace-nowrap text-muted-foreground">
            <it.icon className="h-4 w-4 text-primary" />{it.label}
          </span>
        ))}
      </div>
    </div>
  );
}
