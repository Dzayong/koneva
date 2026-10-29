"use client";

import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "koneva-cs-welcome-dismissed";

function isDismissed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

export function CsWelcomeBanner() {
  const [dismissed, setDismissed] = useState(isDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <div className="relative mb-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-7 w-7" aria-label="Tutup" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
      <div className="flex items-start gap-3">
        <MessageSquare className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div className="space-y-2">
          <h3 className="font-semibold">Selamat datang di KONEVA!</h3>
          <p className="text-sm text-muted-foreground">Sebagai Customer Service, Anda bisa membaca dan membalas percakapan dari device yang sudah diizinkan Owner.</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>Pilih device di atas untuk melihat daftar chat.</li>
            <li>Klik percakapan untuk membaca pesan.</li>
            <li>Ketik balasan di kolom bawah, lalu tekan kirim.</li>
            <li>Anda tidak bisa mengirim pesan baru, mengelola device, atau mengakses pengaturan — hanya membaca dan membalas.</li>
          </ul>
          <p className="text-xs text-muted-foreground">Jika ada device yang belum muncul, minta Owner untuk menambahkan akses di halaman Tim.</p>
        </div>
      </div>
    </div>
  );
}
