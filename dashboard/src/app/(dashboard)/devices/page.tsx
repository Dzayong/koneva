"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddDeviceForm } from "@/components/devices/add-device-form";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import { HealthBar } from "@/components/devices/health-bar";
import { QRCodeDialog } from "@/components/devices/qr-code-dialog";
import { useDeleteDevice, useDevices, usePauseDevice, useResumeDevice } from "@/hooks/use-devices";
import { formatDate, formatPhoneNumber } from "@/lib/utils";
import type { Device } from "@/lib/types";

export default function DevicesPage() {
  const { data: devices, isLoading, refetch, isRefetching } = useDevices();
  const [addOpen, setAddOpen] = useState(false);
  const [qrDeviceKey, setQrDeviceKey] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Devices</h2>
          <p className="text-muted-foreground">Manage your WhatsApp numbers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Device
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Phone Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Health Score</TableHead>
              <TableHead>Last Connected</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : devices && devices.length > 0 ? (
              devices.map((device) => (
                <DeviceRow key={device.id} device={device} onShowQr={setQrDeviceKey} />
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Smartphone className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">No devices yet</p>
                    <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                      Add your first device
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Device</DialogTitle>
            <DialogDescription>Connect a new WhatsApp number to your account.</DialogDescription>
          </DialogHeader>
          <AddDeviceForm onSuccess={() => setAddOpen(false)} />
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

function DeviceRow({
  device,
  onShowQr,
}: {
  device: Device;
  onShowQr: (deviceKey: string) => void;
}) {
  const pauseDevice = usePauseDevice();
  const resumeDevice = useResumeDevice();
  const deleteDevice = useDeleteDevice();

  const handleDelete = () => {
    if (window.confirm(`Delete device "${device.label || device.device_key}"? This cannot be undone.`)) {
      deleteDevice.mutate(device.device_key);
    }
  };

  return (
    <TableRow>
      <TableCell>
        <div>
          <p className="font-medium">{device.label || "Unnamed"}</p>
          <p className="text-sm text-muted-foreground">{device.device_key}</p>
        </div>
      </TableCell>
      <TableCell>
        {device.phone_number ? (
          formatPhoneNumber(device.phone_number)
        ) : (
          <span className="text-muted-foreground">Not set</span>
        )}
      </TableCell>
      <TableCell>
        <DeviceStatusBadge status={device.status} />
      </TableCell>
      <TableCell>
        <HealthBar score={device.health_score} />
      </TableCell>
      <TableCell>
        {device.last_connected ? (
          formatDate(device.last_connected)
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/devices/${device.device_key}`}>View Details</Link>
            </DropdownMenuItem>
            {device.status === "pending_qr" && (
              <DropdownMenuItem onClick={() => onShowQr(device.device_key)}>
                <QrCode className="mr-2 h-4 w-4" />
                Show QR Code
              </DropdownMenuItem>
            )}
            {device.status === "online" ? (
              <DropdownMenuItem
                onClick={() => pauseDevice.mutate(device.device_key)}
                disabled={pauseDevice.isPending}
              >
                <Pause className="mr-2 h-4 w-4" />
                Pause
              </DropdownMenuItem>
            ) : device.status === "paused" ? (
              <DropdownMenuItem
                onClick={() => resumeDevice.mutate(device.device_key)}
                disabled={resumeDevice.isPending}
              >
                <Play className="mr-2 h-4 w-4" />
                Resume
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteDevice.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
