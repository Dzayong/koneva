"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ContactRound, CreditCard, FileClock, LayoutDashboard, MessageSquare, Radio, Search, Settings, Smartphone, Users } from "lucide-react";
import { usePermissions } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const destinations = [
  { label: "Ringkasan", href: "/dashboard", keywords: "dashboard home", permission: undefined, icon: LayoutDashboard },
  { label: "Device WhatsApp", href: "/devices", keywords: "nomor koneksi whatsapp qr", permission: "devices:read" as const, icon: Smartphone },
  { label: "Pesan", href: "/messages", keywords: "chat inbox percakapan", permission: "messages:read" as const, icon: MessageSquare },
  { label: "Broadcast", href: "/broadcast", keywords: "kirim pesan banyak", permission: "messages:send" as const, icon: Radio },
  { label: "Campaign terjadwal", href: "/campaigns", keywords: "jadwal pesan", permission: "messages:send" as const, icon: FileClock },
  { label: "Kontak", href: "/contacts", keywords: "nomor pelanggan audience", permission: "messages:read" as const, icon: ContactRound },
  { label: "Grup & saluran", href: "/groups", keywords: "komunitas channel whatsapp", permission: "devices:read" as const, icon: Users },
  { label: "Tagihan", href: "/billing", keywords: "paket pembayaran invoice saldo", permission: "billing:manage" as const, icon: CreditCard },
  { label: "Aktivitas", href: "/activity", keywords: "audit riwayat log", permission: "audit:read" as const, icon: FileClock },
  { label: "Pengaturan", href: "/settings", keywords: "konfigurasi webhook", permission: "devices:read" as const, icon: Settings },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { can } = usePermissions();
  const normalized = query.trim().toLocaleLowerCase("id-ID");
  const canSearchDevices = can("devices:read");
  const devices = useQuery({
    queryKey: ["global-search-devices"],
    queryFn: () => api.getDevices(),
    enabled: open && canSearchDevices,
    staleTime: 15_000,
    retry: false,
  });
  const canSearchContacts = can("messages:read");
  const contacts = useQuery({
    queryKey: ["global-search-contacts", normalized],
    queryFn: () => api.getContacts({ search: query.trim(), limit: 5, offset: 0 }),
    enabled: open && normalized.length >= 2 && canSearchContacts,
    staleTime: 10_000,
    retry: false,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  const pages = useMemo(() => destinations.filter((item) => !item.permission || can(item.permission))
    .filter((item) => !normalized || `${item.label} ${item.keywords}`.toLocaleLowerCase("id-ID").includes(normalized)), [can, normalized]);
  const matchingDevices = (devices.data ?? []).filter((device) => normalized && `${device.label ?? ""} ${device.phone_number ?? ""} ${device.device_key}`.toLocaleLowerCase("id-ID").includes(normalized)).slice(0, 5);
  const matchingContacts = contacts.data?.data ?? [];
  const hasQuery = normalized.length > 0;
  const noResults = hasQuery && pages.length === 0 && matchingDevices.length === 0 && matchingContacts.length === 0 && !contacts.isFetching && !devices.isFetching;

  function navigate(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="h-10 w-10 justify-center px-0 text-muted-foreground sm:w-48 sm:justify-start sm:px-3 lg:w-64" aria-label="Cari di KONEVA">
        <Search className="h-4 w-4 shrink-0 sm:mr-2" />
        <span className="hidden truncate sm:inline">Cari menu, device, kontak…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground lg:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
        <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:top-[18%]">
          <DialogTitle className="sr-only">Pencarian KONEVA</DialogTitle>
          <DialogDescription className="sr-only">Cari halaman, device WhatsApp, atau kontak.</DialogDescription>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari device, kontak, atau fitur…" className="h-12 border-0 px-0 shadow-none focus-visible:ring-0" maxLength={100} />
            <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">ESC</kbd>
          </div>
          <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
            {!hasQuery && <p className="px-3 py-2 text-xs font-medium text-muted-foreground">MENU UTAMA</p>}
            {pages.length > 0 && <section aria-label="Halaman">
              {hasQuery && <p className="px-3 py-2 text-xs font-medium text-muted-foreground">HALAMAN</p>}
              {pages.map(({ label, href, icon: Icon }) => <button key={href} type="button" onClick={() => navigate(href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"><Icon className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{label}</span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></button>)}
            </section>}
            {matchingDevices.length > 0 && <section aria-label="Device">
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground">DEVICE</p>
              {matchingDevices.map((device) => <button key={device.id} type="button" onClick={() => navigate(`/devices/${encodeURIComponent(device.device_key)}`)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"><Smartphone className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{device.label || device.phone_number || device.device_key}</span><span className="text-xs text-muted-foreground">{device.status === "online" ? "Online" : device.status}</span></button>)}
            </section>}
            {matchingContacts.length > 0 && <section aria-label="Kontak">
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground">KONTAK</p>
              {matchingContacts.map((contact) => <Link key={contact.id} href={`/contacts?search=${encodeURIComponent(contact.name || contact.phone_number)}`} onClick={() => { setOpen(false); setQuery(""); }} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-accent"><ContactRound className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{contact.name || contact.phone_number}</span><span className="text-xs text-muted-foreground">{contact.phone_number}</span></Link>)}
            </section>}
            {(contacts.isFetching || devices.isFetching) && hasQuery && <p className="px-3 py-3 text-sm text-muted-foreground">Mencari…</p>}
            {noResults && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Tidak ada menu, device, atau kontak yang cocok.</p>}
            {!hasQuery && <p className="px-3 py-3 text-xs text-muted-foreground">Ketik nama menu, label/nomor device, nama, atau nomor kontak.</p>}
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground"><span>Pencarian dibatasi ke workspace ini</span><span>Esc untuk menutup</span></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
