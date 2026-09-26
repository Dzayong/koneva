"use client";

import Link from "next/link";
import { AlertTriangle, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDevices } from "@/hooks/use-devices";
import { getDeviceStatusConfig } from "@/lib/utils";

function isAtRisk(status: string, healthScore: number): boolean {
  return status === "banned" || status === "error" || healthScore < 40;
}

export function NotificationCenter() {
  const { data: devices } = useDevices();
  const alerts = (devices ?? []).filter((d) => isAtRisk(d.status, d.health_score));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifikasi">
          <Bell className="h-5 w-5" />
          {alerts.length > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
              {alerts.length > 9 ? "9+" : alerts.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifikasi</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alerts.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Semua nomor dalam kondisi baik</p>
        ) : (
          alerts.map((device) => {
            const config = getDeviceStatusConfig(device.status);
            return (
              <DropdownMenuItem key={device.id} asChild>
                <Link href={`/devices/${device.device_key}`} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {device.label || device.device_key}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className={config.color}>{config.label}</span> · Kesiapan{" "}
                      {device.health_score}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            );
          })
        )}
        {alerts.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="p-2 text-center">
              <Badge variant="outline">{alerts.length} nomor perlu perhatian</Badge>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
