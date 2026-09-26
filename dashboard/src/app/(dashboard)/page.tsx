"use client";

import { useMemo } from "react";
import { CheckCircle2, MessageSquare, QrCode, Smartphone } from "lucide-react";
import { isToday } from "date-fns";
import { StatGrid, StatsCard } from "@/components/dashboard/stats-card";
import { MessagesChart } from "@/components/dashboard/messages-chart";
import { RecentAlerts } from "@/components/dashboard/recent-alerts";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { usePermissions } from "@/hooks/use-me";
import { useDevices } from "@/hooks/use-devices";
import { useMessages } from "@/hooks/use-messages";

const DELIVERED_STATUSES = new Set(["sent", "delivered", "read"]);
const TERMINAL_STATUSES = new Set(["sent", "delivered", "read", "failed", "blocked"]);

export default function DashboardPage() {
  const { user } = usePermissions();
  const { data: devices, isLoading: devicesLoading } = useDevices();
  const { data: messages, isLoading: messagesLoading } = useMessages({ limit: 100, offset: 0 });

  const pendingQr = useMemo(
    () => devices?.filter((d) => d.status === "pending_qr").length ?? 0,
    [devices],
  );

  const onlineDevices = useMemo(
    () => devices?.filter((d) => d.status === "online").length ?? 0,
    [devices],
  );

  // api-gateway has no "messages today" or "success rate" endpoint yet —
  // approximated from the latest page of messages, not a true daily total.
  const messagesToday = useMemo(
    () => messages?.data.filter((m) => isToday(new Date(m.created_at))).length ?? 0,
    [messages],
  );

  const successRate = useMemo(() => {
    const sample = messages?.data ?? [];
    const terminal = sample.filter((m) => TERMINAL_STATUSES.has(m.status));
    if (terminal.length === 0) return 0;
    const delivered = terminal.filter((m) => DELIVERED_STATUSES.has(m.status)).length;
    return (delivered / terminal.length) * 100;
  }, [messages]);

  return (
    <div className="space-y-8 md:space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-display">Ringkasan</h2>
          <p className="mt-2 text-muted-foreground">{user ? `Halo, ${user.name.split(" ")[0]}. ` : ""}Ini kondisi nomor dan pesan Anda hari ini.</p>
        </div>
        <QuickActions />
      </div>

      <SetupChecklist />

      <StatGrid>
        <StatsCard
          title="Jumlah nomor"
          index={0}
          value={devices?.length ?? 0}
          icon={Smartphone}
          description={`${onlineDevices} online`}
          isLoading={devicesLoading}
        />
        <StatsCard
          title="Pesan hari ini"
          index={1}
          value={messagesToday}
          icon={MessageSquare}
          description="Perkiraan dari 100 pesan terbaru"
          isLoading={messagesLoading}
        />
        <StatsCard
          title="Tingkat sukses"
          index={2}
          value={`${successRate.toFixed(1)}%`}
          icon={CheckCircle2}
          description="Dari pesan keluar yang dicek"
          isLoading={messagesLoading}
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
