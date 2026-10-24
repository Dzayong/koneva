"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDevice, useDeviceQR } from "@/hooks/use-device";
import { cn } from "@/lib/utils";

const STEPS = ["Pindai QR", "Tersambung", "Siap digunakan"] as const;

export function QRCodeDialog({
  deviceKey,
  open,
  onOpenChange,
}: {
  deviceKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: device } = useDevice(deviceKey);
  const connected = device?.status === "online";
  const { data, isLoading, isError } = useDeviceQR(deviceKey, open && !connected);

  useEffect(() => {
    if (open && connected) queryClient.invalidateQueries({ queryKey: ["devices"] });
  }, [open, connected, queryClient]);

  const stage = connected ? 2 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{connected ? "Device tersambung" : "Sambungkan device"}</DialogTitle>
          <DialogDescription>
            {connected
              ? "Nomor Anda sudah aktif di KONEVA."
              : "Di HP, buka WhatsApp, lalu Perangkat tertaut, Tautkan perangkat, dan arahkan kamera ke kode di bawah."}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-xs" aria-label="Tahapan">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors", i <= stage ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{i + 1}</span>
              <span className={cn("truncate", i <= stage ? "font-medium" : "text-muted-foreground")}>{label}</span>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1 transition-colors", i < stage ? "bg-primary" : "bg-border")} />}
            </li>
          ))}
        </ol>

        <div className="flex min-h-64 items-center justify-center">
          <AnimatePresence mode="wait">
            {connected ? (
              <motion.div key="connected" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 text-sm">
                <div className="flex items-center gap-2 text-base font-semibold text-green-700"><CheckCircle2 className="h-6 w-6" />Berhasil tersambung</div>
                <p className="text-muted-foreground">
                  Device ini siap digunakan. Tetap kirim pesan dengan izin penerima; aktivitas berlebihan dapat membuat WhatsApp membatasi nomor.
                </p>
              </motion.div>
            ) : data?.qr_code ? (
              <motion.div key="qr" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="rounded-lg border bg-white p-4">
                <QRCodeSVG value={data.qr_code} size={224} />
              </motion.div>
            ) : (
              <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                {isError ? <p>Tidak bisa menghubungi server. Mencoba lagi…</p> : <p>{isLoading ? "Memuat kode QR…" : "Menunggu nomor membuat kode QR. Biasanya kurang dari setengah menit."}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!connected && data?.qr_code && <p className="text-center text-xs text-muted-foreground">Kode QR diperbarui otomatis. Jika gagal, tunggu kode baru muncul lalu pindai lagi.</p>}
        {connected && <Button onClick={() => onOpenChange(false)} className="w-full">Selesai</Button>}
      </DialogContent>
    </Dialog>
  );
}
