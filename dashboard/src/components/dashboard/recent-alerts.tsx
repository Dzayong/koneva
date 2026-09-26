import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDeviceStatusConfig, getHealthConfig } from "@/lib/utils";
import type { Device } from "@/lib/types";

function isAtRisk(device: Device): boolean {
  return device.status === "banned" || device.status === "error" || device.health_score < 40;
}

export function RecentAlerts({ devices }: { devices: Device[] }) {
  const atRisk = devices.filter(isAtRisk);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Peringatan</CardTitle>
      </CardHeader>
      <CardContent>
        {atRisk.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-sm text-muted-foreground">Semua nomor dalam kondisi baik</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {atRisk.map((device) => {
              const statusConfig = getDeviceStatusConfig(device.status);
              const healthConfig = getHealthConfig(device.health_score);
              return (
                <li key={device.id}>
                  <Link
                    href={`/devices/${device.device_key}`}
                    className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-accent"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {device.label || device.device_key}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className={statusConfig.color}>{statusConfig.label}</span>
                        {" · "}
                        <span className={healthConfig.color}>
                          Kesiapan {device.health_score}
                        </span>
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
