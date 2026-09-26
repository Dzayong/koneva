"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Plus, RefreshCw, Search, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddDeviceForm } from "@/components/devices/add-device-form";
import { DeviceCard, DeviceCardSkeleton } from "@/components/devices/device-card";
import { QRCodeDialog } from "@/components/devices/qr-code-dialog";
import { useDevices } from "@/hooks/use-devices";
import { usePermissions } from "@/hooks/use-me";
import { useUrlFlag } from "@/hooks/use-url-flag";

export default function DevicesPage() {
  const { data: devices, isLoading, refetch, isRefetching } = useDevices();
  const router = useRouter();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [manualAdd, setManualAdd] = useState(false);
  const [addDismissed, setAddDismissed] = useState(false);
  const [qrDeviceKey, setQrDeviceKey] = useState<string | null>(null);

  // The setup checklist links here with ?add=1 to open the form straight away.
  const addRequested = useUrlFlag("add");
  const addOpen = manualAdd || (addRequested && !addDismissed && can("devices:write"));
  const setAddOpen = (open: boolean) => {
    setManualAdd(open);
    if (!open) setAddDismissed(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (devices ?? []).filter(
      (d) =>
        (statusFilter === "all" || d.status === statusFilter) &&
        (!q ||
          d.label?.toLowerCase().includes(q) ||
          d.device_key.toLowerCase().includes(q) ||
          d.phone_number?.includes(q)),
    );
  }, [devices, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-heading">Device</h2>
          <p className="text-muted-foreground">Device adalah satu nomor WhatsApp yang tersambung ke KONEVA.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Muat ulang
          </Button>
          {can("devices:write") && <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah device
          </Button>}
        </div>
      </div>

      <div className="surface flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, kode, atau nomor telepon…"
            className="pl-9"
            aria-label="Cari device"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="pending_qr">Menunggu QR</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="paused">Dijeda</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <DeviceCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((device) => (
              <DeviceCard key={device.id} device={device} onShowQr={setQrDeviceKey} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed">
          <Smartphone className="h-8 w-8 text-muted-foreground" />
          {devices && devices.length > 0 ? (
            <p className="text-muted-foreground">Tidak ada device yang cocok</p>
          ) : (
            <>
              <p className="text-muted-foreground">Belum ada device</p>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                Tambah device pertama
              </Button>
            </>
          )}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah device</DialogTitle>
            <DialogDescription>Sambungkan device WhatsApp baru ke workspace Anda.</DialogDescription>
          </DialogHeader>
          <AddDeviceForm
            onSuccess={(device) => {
              setAddOpen(false);
              router.push(`/devices/${device.device_key}?connect=1`);
            }}
          />
        </DialogContent>
      </Dialog>

      {qrDeviceKey && (
        <QRCodeDialog
          deviceKey={qrDeviceKey}
          open={Boolean(qrDeviceKey)}
          onOpenChange={(open) => !open && setQrDeviceKey(null)}
        />
      )}
    </div>
  );
}
