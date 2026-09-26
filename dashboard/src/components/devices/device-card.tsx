"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { MoreHorizontal, Pause, Play, QrCode, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import { useDeleteDevice, usePauseDevice, useResumeDevice } from "@/hooks/use-devices";
import { cn, formatDate, formatPhoneNumber, getHealthConfig } from "@/lib/utils";
import type { Device } from "@/lib/types";

const RING_RADIUS = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function HealthRing({ score }: { score: number }) {
  const reduceMotion = useReducedMotion();
  const value = Math.min(100, Math.max(0, score));
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={RING_RADIUS} strokeWidth="4" fill="none" className="stroke-muted" />
        <motion.circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          initial={reduceMotion ? false : { strokeDashoffset: RING_CIRCUMFERENCE }}
          animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - value / 100) }}
          transition={{ duration: reduceMotion ? 0 : 0.4, ease: "easeOut" }}
          className={cn("stroke-current", getHealthConfig(value).color)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

export function DeviceCard({
  device,
  onShowQr,
}: {
  device: Device;
  onShowQr: (deviceKey: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const pauseDevice = usePauseDevice();
  const resumeDevice = useResumeDevice();
  const deleteDevice = useDeleteDevice();

  const handleDelete = () => {
    if (window.confirm(`Hapus nomor "${device.label || device.device_key}"? Nomor akan diputus dan tidak bisa dikembalikan.`)) {
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
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-semibold">
            {(device.label || "WA").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{device.label || "Tanpa nama"}</h3>
            <p className="truncate text-xs text-muted-foreground">{device.device_key}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {device.phone_number ? formatPhoneNumber(device.phone_number) : "Belum ada nomor"}
            </p>
          </div>
        </div>
        <HealthRing score={device.health_score} />
      </div>

      <div className="relative mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <DeviceStatusBadge status={device.status} />
        <span>{device.last_connected ? formatDate(device.last_connected) : "Belum pernah tersambung"}</span>
      </div>

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Aksi</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {device.status === "online" && (
              <DropdownMenuItem
                onClick={() => pauseDevice.mutate(device.device_key)}
                disabled={pauseDevice.isPending}
              >
                <Pause className="mr-2 h-4 w-4" />
                Jeda
              </DropdownMenuItem>
            )}
            {device.status === "paused" && (
              <DropdownMenuItem
                onClick={() => resumeDevice.mutate(device.device_key)}
                disabled={resumeDevice.isPending}
              >
                <Play className="mr-2 h-4 w-4" />
                Lanjutkan
              </DropdownMenuItem>
            )}
            {(device.status === "online" || device.status === "paused") && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={handleDelete} disabled={deleteDevice.isPending}>
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
