"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useMe, usePermissions } from "@/hooks/use-me";

/** Shown to everyone in the workspace, but only the owner gets the link to fix it. */
export function SubscriptionBanner() {
  const sub = useMe().data?.subscription;
  const { can } = usePermissions();
  if (!sub || sub.plan_id === "internal") return null;

  let text: string | null = null;
  let severe = false;
  if (sub.status === "suspended" || sub.status === "expired" || sub.status === "cancelled") {
    severe = true;
    text = "Paket tidak aktif, pengiriman pesan dan penambahan nomor dihentikan sementara.";
  } else if (sub.status === "past_due") {
    severe = true;
    text = "Pembayaran terlambat. Pengiriman masih jalan selama masa tenggang, lalu akan dihentikan.";
  } else if ((sub.status === "trial" || sub.status === "active") && sub.days_left !== null && sub.days_left <= 3) {
    text = sub.days_left <= 0 ? "Paket berakhir hari ini." : `Paket ${sub.plan_name} berakhir ${sub.days_left} hari lagi.`;
  }
  if (!text) return null;

  return (
    <div role="status" className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm md:px-8 ${severe ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{text}</span>
      {can("billing:manage") ? (
        <Link href="/billing" className="font-semibold underline underline-offset-2">Buka Tagihan</Link>
      ) : (
        <span>Hubungi pemilik workspace.</span>
      )}
    </div>
  );
}
