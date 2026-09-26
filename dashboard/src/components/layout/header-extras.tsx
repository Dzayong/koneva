"use client";

import Link from "next/link";
import { Hourglass, LifeBuoy } from "lucide-react";
import { useMe, usePermissions } from "@/hooks/use-me";

/** Trial countdown: a plain, honest reminder that links to the fix (owner only sees the link). */
export function TrialChip() {
  const sub = useMe().data?.subscription;
  const { can } = usePermissions();
  if (!sub || sub.status !== "trial" || sub.days_left === null) return null;
  const urgent = sub.days_left <= 3;
  const label = sub.days_left <= 0 ? "Percobaan berakhir hari ini" : `Sisa ${sub.days_left} hari percobaan`;
  const cls = `hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:flex ${urgent ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-card text-muted-foreground"}`;
  return can("billing:manage")
    ? <Link href="/billing" className={`${cls} hover:border-primary/40`}><Hourglass className="h-3.5 w-3.5" />{label}</Link>
    : <span className={cls}><Hourglass className="h-3.5 w-3.5" />{label}</span>;
}

/** One tap to a human. Most customers would rather ask on WhatsApp than read docs. */
export function HelpButton() {
  const contact = useMe().data?.support_contact;
  const digits = contact?.replace(/\D/g, "");
  if (!digits) return null;
  const text = encodeURIComponent("Halo, saya butuh bantuan dengan KONEVA.");
  return (
    <a href={`https://wa.me/${digits}?text=${text}`} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground">
      <LifeBuoy className="h-3.5 w-3.5" /><span className="hidden sm:inline">Bantuan</span>
    </a>
  );
}
