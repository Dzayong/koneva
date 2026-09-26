"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/use-me";
import { useDevices } from "@/hooks/use-devices";
import { useMessages } from "@/hooks/use-messages";
import { readFlag } from "@/hooks/use-url-flag";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  href: string;
  action: string;
  optional?: boolean;
}

const DISMISS_KEY = "wa_gateway_setup_dismissed";

export function SetupChecklist() {
  const { can } = usePermissions();
  const { data: devices } = useDevices();
  const { data: messages } = useMessages({ limit: 100, offset: 0 });
  const tenant = useQuery({ queryKey: ["tenant", "me"], queryFn: () => api.getMyTenant(), retry: false });
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.getTeam(), enabled: can("team:manage"), retry: false });
  // Server render assumes "dismissed" so nothing flashes before the browser's saved choice is read.
  const savedDismissed = useSyncExternalStore(() => () => undefined, () => readFlag(DISMISS_KEY), () => true);
  const [justDismissed, setJustDismissed] = useState(false);
  const dismissed = savedDismissed || justDismissed;

  const steps = useMemo<Step[]>(() => {
    const list = devices ?? [];
    const pending = list.find((d) => d.status === "pending_qr");
    const list_: Step[] = [
      { id: "device", title: "Sambungkan device WhatsApp", hint: "Tambahkan nomor yang akan dipakai mengirim dan menerima pesan.", done: list.length > 0, href: "/devices?add=1", action: "Tambah device" },
      { id: "scan", title: "Pindai kode QR di HP", hint: "Buka WhatsApp di HP, lalu Perangkat tertaut, Tautkan perangkat.", done: list.some((d) => d.status === "online"), href: pending ? `/devices/${pending.device_key}?connect=1` : "/devices", action: pending ? "Tampilkan QR" : "Lihat device" },
      { id: "send", title: "Kirim pesan pertama", hint: "Nomor baru belum boleh memulai percakapan selama 2 hari pertama. Kirim pesan ke nomor ini dari HP lain, lalu balas dari sini.", done: (messages?.data ?? []).some((m) => m.direction === "outbound" && ["sent", "delivered", "read"].includes(m.status)), href: "/developers/quickstart", action: "Coba kirim" },
      { id: "webhook", title: "Pasang webhook", hint: "Terima kabar saat pesan terkirim, dibalas, atau nomor bermasalah.", done: Boolean(tenant.data?.webhook_url), href: "/developers/webhooks", action: "Atur webhook", optional: true },
    ];
    if (can("team:manage")) {
      const t = team.data;
      list_.push({ id: "team", title: "Undang rekan kerja", hint: "Beri developer atau operator akses sesuai perannya.", done: Boolean(t && (t.members.length > 1 || t.invitations.length > 0)), href: "/team", action: "Undang", optional: true });
    }
    return list_;
  }, [devices, messages, tenant.data, team.data, can]);

  const required = steps.filter((s) => !s.optional);
  const doneRequired = required.filter((s) => s.done).length;
  const allRequiredDone = doneRequired === required.length;
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);
  const loaded = devices !== undefined && messages !== undefined;

  if (!loaded) return null;

  if (allRequiredDone && dismissed) return null;

  if (allRequiredDone) {
    return (
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-accent px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-accent-foreground">
          <Check className="h-4 w-4" /> Persiapan selesai. Nomor Anda sudah tersambung dan mengirim pesan.
        </p>
        <Button variant="ghost" size="sm" onClick={() => { setJustDismissed(true); try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage unavailable */ } }}>Sembunyikan</Button>
      </motion.div>
    );
  }

  return (
    <section aria-labelledby="setup-title" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h3 id="setup-title" className="text-heading text-lg">Mulai di sini</h3>
          <p className="text-sm text-muted-foreground">{doneRequired} dari {required.length} langkah wajib selesai{doneRequired < required.length ? `, sekitar ${Math.max(1, (required.length - doneRequired) * 2)} menit lagi` : ""}</p>
        </div>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={doneRequired} aria-label="Kemajuan persiapan">
          <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${(doneRequired / required.length) * 100}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
        </div>
      </div>
      <ol className="divide-y">
        {steps.map((step) => {
          const isNext = next?.id === step.id;
          return (
            <li key={step.id} className={cn("flex items-center gap-4 px-5 py-3.5", isNext && "bg-accent/40")}>
              <span
                className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs", step.done ? "border-primary bg-primary text-primary-foreground" : isNext ? "border-primary text-primary" : "text-muted-foreground")}
                aria-hidden="true"
              >
                <AnimatePresence initial={false}>
                  {step.done && <motion.span key="c" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 25 }}><Check className="h-3.5 w-3.5" /></motion.span>}
                </AnimatePresence>
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                  {step.title}{step.optional && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground no-underline">Opsional</span>}
                </p>
                {!step.done && <p className="text-sm text-muted-foreground">{step.hint}</p>}
              </div>
              {!step.done && (
                <Button asChild size="sm" variant={isNext ? "default" : "outline"}>
                  <Link href={step.href}>{step.action}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
                </Button>
              )}
              <span className="sr-only">{step.done ? "Selesai" : "Belum selesai"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
