"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, MessageSquare, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import { StatGrid, StatsCard } from "@/components/dashboard/stats-card";
import { MessagesChart } from "@/components/dashboard/messages-chart";
import { RecentAlerts } from "@/components/dashboard/recent-alerts";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { usePermissions } from "@/hooks/use-me";
import { useDevices } from "@/hooks/use-devices";
import { useDashboardStats } from "@/hooks/use-messages";
import { formatDate, getHealthConfig } from "@/lib/utils";

export default function DashboardPage() {
  const { user } = usePermissions();
  const { data: devices, isLoading: devicesLoading } = useDevices();
  const { data: stats, isLoading: statsLoading, isError: statsError } = useDashboardStats();

  const pendingQr = useMemo(
    () => devices?.filter((d) => d.status === "pending_qr").length ?? 0,
    [devices],
  );

  const onlineDevices = useMemo(
    () => devices?.filter((d) => d.status === "online").length ?? 0,
    [devices],
  );

  const healthDevices = useMemo(
    () => [...(devices ?? [])]
      .sort((a, b) => a.health_score - b.health_score)
      .slice(0, 5),
    [devices],
  );

  return (
    <div className="space-y-8 md:space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-display">Ringkasan</h2>
          <p className="mt-2 text-muted-foreground">{user ? `Halo, ${user.name.split(" ")[0]}. ` : ""}Ini kondisi nomor dan pesan Anda hari ini.</p>
        </div>
      </div>

      <QuickActions />
      <SetupChecklist />

      <StatGrid>
        <StatsCard
          title="Jumlah device"
          index={0}
          value={devices?.length ?? 0}
          icon={Smartphone}
          description={`${onlineDevices} online`}
          isLoading={devicesLoading}
        />
        <StatsCard
          title="Pesan hari ini"
          index={1}
          value={statsError ? "—" : stats?.messages_today ?? 0}
          icon={MessageSquare}
          description="Masuk + keluar, semua status, sejak 00.00 WIB"
          isLoading={statsLoading}
        />
        <StatsCard
          title="Tingkat pengantaran"
          index={2}
          value={statsError ? "—" : `${(stats?.delivery_rate ?? 0).toFixed(1)}%`}
          icon={CheckCircle2}
          description="Pesan keluar berstatus akhir · seluruh riwayat"
          isLoading={statsLoading}
        />
        <StatsCard
          title="Menunggu QR"
          index={3}
          value={pendingQr}
          icon={QrCode}
          description="Belum dipindai di HP"
          isLoading={devicesLoading}
        />
      </StatGrid>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Kesehatan per device</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Skor dan status tiap device; urutan skor terendah lebih dulu.</p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/devices">Semua device<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </CardHeader>
        <CardContent>
          {devicesLoading ? (
            <div className="space-y-3" aria-label="Memuat kesehatan device">
              {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : healthDevices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center">
              <ShieldCheck className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Belum ada device</p>
              <p className="text-sm text-muted-foreground">Tambahkan device untuk mulai memantau status dan kesehatannya.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {healthDevices.map((device) => {
                const health = getHealthConfig(device.health_score);
                return (
                  <li key={device.id}>
                    <Link
                      href={`/devices/${device.device_key}`}
                      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{device.label || device.device_key}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {device.last_connected ? `Terakhir tersambung ${formatDate(device.last_connected)}` : "Belum pernah tersambung"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <DeviceStatusBadge status={device.status} />
                        <span className={`text-sm font-semibold ${health.color}`}>
                          Kesehatan {device.health_score}/100 · {health.label}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-7 lg:gap-6">
        <div className="lg:col-span-4">
          <MessagesChart />
        </div>
        <div className="lg:col-span-3">
          <RecentAlerts devices={devices ?? []} />
        </div>
      </div>
    </div>
  );
}
