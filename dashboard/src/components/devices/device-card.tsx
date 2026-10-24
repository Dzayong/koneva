"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { KeyRound, Loader2, MoreHorizontal, Pause, Play, Plus, QrCode, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import { usePermissions } from "@/hooks/use-me";
import { useDeleteDevice, usePauseDevice, useReconnectDevice, useResumeDevice } from "@/hooks/use-devices";
import { useCreateApiKey, useRotateApiKey } from "@/hooks/use-developer";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { cn, formatDate, formatPhoneNumber } from "@/lib/utils";
import type { ApiKeyRecord, CreatedApiKey, Device } from "@/lib/types";

function DeviceCardApiKeyAction({
  deviceKey,
  deviceLabel,
  apiKey,
  loading,
  error,
  onRetry,
}: {
  deviceKey: string;
  deviceLabel: string;
  apiKey?: ApiKeyRecord;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const create = useCreateApiKey();
  const rotate = useRotateApiKey();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const createKey = () => create.mutate({
    name: `${deviceLabel || deviceKey} integration`.slice(0, 80),
    device_key: deviceKey,
    scopes: ["messages:send", "messages:read", "devices:read"],
  }, { onSuccess: setCreated });

  const rotateKey = () => {
    if (!apiKey) return;
    rotate.mutate(apiKey.id, { onSuccess: (key) => { setConfirmRotate(false); setCreated(key); } });
  };

  return (
    <>
      <div className="relative mt-4 flex min-w-0 items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] leading-4 text-muted-foreground">API key device</p>
            {loading ? <p className="text-xs">Memeriksa…</p> : error ? (
              <button type="button" className="text-xs text-destructive underline underline-offset-2" onClick={onRetry}>Gagal dimuat · coba lagi</button>
            ) : apiKey ? (
              <p className="truncate font-mono text-xs">{apiKey.prefix}••••••••</p>
            ) : (
              <p className="text-xs text-muted-foreground">Belum dibuat</p>
            )}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={loading || error || create.isPending || rotate.isPending}
          onClick={() => apiKey ? setConfirmRotate(true) : createKey()}
        >
          {create.isPending || rotate.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : apiKey ? <RotateCw className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
          {apiKey ? "Putar & salin" : "Buat & salin"}
        </Button>
      </div>

      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Putar API key device?</DialogTitle>
            <DialogDescription>
              KONEVA hanya menyimpan hash, jadi key lama tidak bisa ditampilkan lagi. Key baru akan ditampilkan sekali untuk disalin. Key lama masih berlaku 24 jam; setelah itu, perbarui key di sistem integrasi Anda.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRotate(false)}>Batal</Button>
            <Button type="button" onClick={rotateKey} disabled={rotate.isPending}>
              {rotate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Putar dan tampilkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {created && (
        <SecretReveal
          open
          title="API key siap disalin"
          description={`Key untuk ${deviceLabel || deviceKey} terikat ke device ini dan hanya ditampilkan sekarang.`}
          secret={created.key}
          onDone={() => setCreated(null)}
        />
      )}
    </>
  );
}

export function DeviceCard({
  device,
  onShowQr,
  apiKey,
  apiKeysLoading = false,
  apiKeysError = false,
  onRetryApiKeys = () => undefined,
}: {
  device: Device;
  onShowQr: (deviceKey: string) => void;
  apiKey?: ApiKeyRecord;
  apiKeysLoading?: boolean;
  apiKeysError?: boolean;
  onRetryApiKeys?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const pauseDevice = usePauseDevice();
  const resumeDevice = useResumeDevice();
  const reconnectDevice = useReconnectDevice();
  const deleteDevice = useDeleteDevice();
  const { can } = usePermissions();
  const canWrite = can("devices:write"), canDelete = can("devices:delete"), canManageKeys = can("keys:manage");

  const handleDelete = () => {
    if (window.confirm(`Hapus device "${device.label || device.device_key}"? Device akan diputus dan tidak bisa dikembalikan.`)) {
      deleteDevice.mutate(device.device_key);
    }
  };

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
      className="group relative overflow-hidden rounded-2xl border bg-card p-5 shadow-card transition-[box-shadow,border-color] duration-150 hover:shadow-elevated hover:border-primary/20"
    >
      <div className="relative flex items-start gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-semibold">
            {(device.label || "WA").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{device.label || "Tanpa nama"}</h3>
            <p className="truncate text-xs text-muted-foreground">{device.device_key}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {device.phone_number ? formatPhoneNumber(device.phone_number) : "Belum ada device"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <DeviceStatusBadge status={device.status} />
        <span>{device.last_connected ? formatDate(device.last_connected) : "Belum pernah tersambung"}</span>
      </div>

      {canManageKeys && (
        <DeviceCardApiKeyAction
          deviceKey={device.device_key}
          deviceLabel={device.label || ""}
          apiKey={apiKey}
          loading={apiKeysLoading}
          error={apiKeysError}
          onRetry={onRetryApiKeys}
        />
      )}

      <div className="relative mt-5 flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/devices/${device.device_key}`}>Lihat detail</Link>
        </Button>
        {device.status === "pending_qr" && (
          <Button size="sm" onClick={() => onShowQr(device.device_key)}>
            <QrCode className="mr-2 h-4 w-4" />
            Pindai QR
          </Button>
        )}
        {(device.status === "offline" || device.status === "error") && canWrite && (
          <Button
            size="sm"
            disabled={reconnectDevice.isPending}
            onClick={() => reconnectDevice.mutate(device.device_key, { onSuccess: () => onShowQr(device.device_key) })}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Coba sambungkan
          </Button>
        )}
        {(canWrite || canDelete) && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Aksi</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canWrite && device.status === "online" && (
              <DropdownMenuItem
                onClick={() => pauseDevice.mutate(device.device_key)}
                disabled={pauseDevice.isPending}
              >
                <Pause className="mr-2 h-4 w-4" />
                Jeda
              </DropdownMenuItem>
            )}
            {canWrite && device.status === "paused" && (
              <DropdownMenuItem
                onClick={() => resumeDevice.mutate(device.device_key)}
                disabled={resumeDevice.isPending}
              >
                <Play className="mr-2 h-4 w-4" />
                Lanjutkan
              </DropdownMenuItem>
            )}
            {canWrite && canDelete && (device.status === "online" || device.status === "paused") && <DropdownMenuSeparator />}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onClick={handleDelete} disabled={deleteDevice.isPending}>
                <Trash2 className="mr-2 h-4 w-4" />
                Hapus
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
    </motion.div>
  );
}

export function DeviceCardSkeleton() {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="h-16 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-5 w-full" />
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}
