"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, Search, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const updates = [
  {
    label: "FITUR",
    title: "Cari menu, device, dan kontak lebih cepat",
    summary: "Buka pencarian dari header atau tekan Ctrl+K.",
    detail: "Pencarian cepat membantu menemukan halaman berdasarkan nama fitur, device berdasarkan nama/nomor/ID, dan kontak berdasarkan nama atau nomor. Hasilnya mengikuti izin akun di workspace.",
    icon: Search,
  },
  {
    label: "UPDATE",
    title: "Ringkasan workspace lebih lengkap",
    summary: "Pantau kondisi device, pesan, kontak, dan pemakaian paket dari satu halaman.",
    detail: "Halaman Ringkasan menampilkan jumlah device dan status online, aktivitas pesan hari ini, tingkat pengantaran, total kontak, kesehatan device, serta pemakaian paket jika akunmu punya akses tagihan.",
    icon: Smartphone,
  },
  {
    label: "PANDUAN",
    title: "Kelola grup dan komunitas WhatsApp",
    summary: "Lihat daftar grup, buka percakapan, dan kelola info grup dari satu tempat.",
    detail: "Buka Grup & saluran, pilih device WhatsApp, lalu pilih grup untuk melihat percakapan dan pengaturan yang didukung koneksi. Ketersediaan tindakan bergantung pada status device dan kemampuan WhatsApp.",
    href: "/groups",
    icon: BookOpen,
  },
  {
    label: "PANDUAN",
    title: "Kirim pesan ke kontak yang sesuai",
    summary: "Catat persetujuan penerima dan periksa status sebelum mencoba ulang pesan.",
    detail: "Gunakan daftar kontak untuk menyimpan status persetujuan penerima. Jika pesan gagal atau statusnya belum pasti, periksa percakapan terlebih dahulu sebelum membuat pengiriman baru.",
    href: "/contacts",
    icon: ShieldCheck,
  },
];

export function ProductUpdates() {
  const [allOpen, setAllOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? null : updates[selectedIndex];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Info & pembaruan</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Fitur baru dan panduan singkat KONEVA.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAllOpen(true)}>Lihat semua<ArrowRight className="ml-2 h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y">
            {updates.slice(0, 3).map((item, index) => {
              const Icon = item.icon;
              return <li key={item.title}>
                <button type="button" onClick={() => setSelectedIndex(index)} className="group flex w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary">{item.label}</span>
                      <span className="truncate text-sm font-medium group-hover:text-primary">{item.title}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{item.summary}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>;
            })}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Info & pembaruan KONEVA</DialogTitle>
            <DialogDescription>Pengumuman fitur dan panduan penggunaan workspace.</DialogDescription>
          </DialogHeader>
          <ul className="-mx-2 divide-y">
            {updates.map((item, index) => {
              const Icon = item.icon;
              return <li key={item.title}>
                <button type="button" onClick={() => { setAllOpen(false); setSelectedIndex(index); }} className="flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-accent">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.summary}</span></span>
                </button>
              </li>;
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelectedIndex(null); }}>
        {selected && <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected.title}</DialogTitle>
            <DialogDescription>{selected.label === "PANDUAN" ? "Panduan singkat" : "Pembaruan produk"}</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">{selected.detail}</p>
          {selected.href && <Button asChild><Link href={selected.href} onClick={() => setSelectedIndex(null)}>Buka halaman<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>}
        </DialogContent>}
      </Dialog>
    </>
  );
}
