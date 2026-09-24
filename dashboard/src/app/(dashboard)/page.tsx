"use client";

import { useMemo } from "react";
import { CheckCircle2, MessageSquare, Smartphone, TrendingUp } from "lucide-react";
import { isToday } from "date-fns";
import { StatsCard } from "@/components/dashboard/stats-card";
import { MessagesChart } from "@/components/dashboard/messages-chart";
import { RecentAlerts } from "@/components/dashboard/recent-alerts";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { useDevices } from "@/hooks/use-devices";
import { useMessages } from "@/hooks/use-messages";

const DELIVERED_STATUSES = new Set(["sent", "delivered", "read"]);
const TERMINAL_STATUSES = new Set(["sent", "delivered", "read", "failed", "blocked"]);

export default function DashboardPage() {
  const { data: devices, isLoading: devicesLoading } = useDevices();
  const { data: messages, isLoading: messagesLoading } = useMessages({ limit: 100, offset: 0 });

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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Overview of your WhatsApp Gateway</p>
        </div>
        <QuickActions />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Devices"
          value={devices?.length ?? 0}
          icon={Smartphone}
          description={`${onlineDevices} online`}
          isLoading={devicesLoading}
        />
        <StatsCard
          title="Messages Today"
          value={messagesToday}
          icon={MessageSquare}
          description="Approximate, latest 100 sampled"
          isLoading={messagesLoading}
        />
        <StatsCard
          title="Success Rate"
          value={`${successRate.toFixed(1)}%`}
          icon={CheckCircle2}
          description="Of sampled sent messages"
          isLoading={messagesLoading}
        />
        <StatsCard
          title="Active Devices"
          value={onlineDevices}
          icon={TrendingUp}
          description={`of ${devices?.length ?? 0} total`}
          isLoading={devicesLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
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
