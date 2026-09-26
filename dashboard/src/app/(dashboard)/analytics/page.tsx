"use client";

import { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import { CheckCheck, MessageSquare, Smartphone, Timer } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatGrid, StatsCard } from "@/components/dashboard/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsDaily, useAnalyticsOverview } from "@/hooks/use-analytics";
import { useMessages } from "@/hooks/use-messages";
import { useDevices } from "@/hooks/use-devices";
import { getHealthConfig, getMessageStatusConfig } from "@/lib/utils";
import type { MessageStatus } from "@/lib/types";

const STATUS_COLORS: Record<MessageStatus, string> = {
  queued: "#9ca3af",
  sending: "#3b82f6",
  sent: "#22c55e",
  delivered: "#16a34a",
  read: "#2563eb",
  failed: "#dc2626",
  blocked: "#b91c1c",
  received: "#0891b2",
};

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)} dtk`;
  return `${(seconds / 60).toFixed(1)} mnt`;
}

export default function AnalyticsPage() {
  const reduceMotion = useReducedMotion();
  // Overview + daily series are true server-side aggregates; the status pie and
  // per-device bars below are still sampled from the latest 100 messages.
  const { data: overview, isLoading: overviewLoading } = useAnalyticsOverview();
  const { data: daily, isLoading: dailyLoading } = useAnalyticsDaily(14);
  const { data: messages, isLoading } = useMessages({ limit: 100, offset: 0 });
  const { data: devices, isLoading: devicesLoading } = useDevices();

  const statusBreakdown = useMemo(() => {
    const counts = new Map<MessageStatus, number>();
    for (const m of messages?.data ?? []) {
      counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, count]) => ({
      status,
      count,
      label: getMessageStatusConfig(status).label,
    }));
  }, [messages]);

  const deliveryRateByDevice = useMemo(() => {
    const byDevice = new Map<string, { total: number; delivered: number }>();
    for (const m of messages?.data ?? []) {
      if (m.direction === "inbound") continue;
      const entry = byDevice.get(m.device_key) ?? { total: 0, delivered: 0 };
      entry.total += 1;
      if (["sent", "delivered", "read"].includes(m.status)) entry.delivered += 1;
      byDevice.set(m.device_key, entry);
    }
    return Array.from(byDevice.entries()).map(([device_key, { total, delivered }]) => ({
      device_key,
      rate: total > 0 ? Math.round((delivered / total) * 100) : 0,
    }));
  }, [messages]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-heading">Analitik</h2>
        <p className="text-muted-foreground">
          Total dan tren 14 hari mencakup semua pesan; rincian di bawahnya dari 100 pesan terbaru.
        </p>
      </div>

      <StatGrid>
        <StatsCard
          index={0}
          title="Total pesan"
          value={(overview?.total_messages ?? 0).toLocaleString()}
          icon={MessageSquare}
          description="Masuk + keluar"
          isLoading={overviewLoading}
        />
        <StatsCard
          index={1}
          title="Tingkat sampai"
          value={`${Number(overview?.delivery_rate ?? 0).toFixed(1)}%`}
          icon={CheckCheck}
          description="Pesan keluar yang sampai atau dibaca"
          isLoading={overviewLoading}
        />
        <StatsCard
          index={2}
          title="Rata-rata balasan"
          value={formatSeconds(Number(overview?.avg_response_time ?? 0))}
          icon={Timer}
          description="Waktu membalas pesan masuk"
          isLoading={overviewLoading}
        />
        <StatsCard
          index={3}
          title="Device aktif"
          value={overview?.active_devices ?? 0}
          icon={Smartphone}
          description={`dari ${devices?.length ?? 0} total`}
          isLoading={overviewLoading}
        />
      </StatGrid>

      <Card>
        <CardHeader>
          <CardTitle>Pesan, 14 hari terakhir</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <AreaChart data={daily ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d: string) => d.slice(5, 10)}
                />
                <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="outbound" name="Keluar" stackId="1" stroke="var(--chart-1)" strokeWidth={1.5} fill="var(--chart-1)" fillOpacity={0.08} isAnimationActive={!reduceMotion} animationDuration={300} />
                <Area type="monotone" dataKey="inbound" name="Masuk" stackId="1" stroke="var(--chart-2)" strokeWidth={1.5} fill="var(--chart-2)" fillOpacity={0.08} isAnimationActive={!reduceMotion} animationDuration={300} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rincian status pesan</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : statusBreakdown.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Belum ada pesan</p>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    isAnimationActive={!reduceMotion}
                    animationDuration={300}
                    // recharts' PieLabelRenderProps doesn't carry the typed
                    // data payload through — this is display-only formatting.
                    label={(props: unknown) => {
                      const entry = props as { label?: string; count?: number };
                      return `${entry.label ?? ""}: ${entry.count ?? 0}`;
                    }}
                  >
                    {statusBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tingkat sampai per device</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : deliveryRateByDevice.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Belum ada pesan</p>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={deliveryRateByDevice}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="device_key" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    unit="%"
                  />
                  <Tooltip formatter={(v: unknown) => [`${String(v)}%`, "Tingkat sampai"]} />
                  <Bar dataKey="rate" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={!reduceMotion} animationDuration={300} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skor kesiapan device</CardTitle>
        </CardHeader>
        <CardContent>
          {devicesLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !devices || devices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Belum ada device</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {devices.map((d) => {
                const config = getHealthConfig(d.health_score);
                return (
                  <div key={d.id} className="rounded-2xl border p-3 text-center">
                    <p className="truncate text-sm font-medium">{d.label || d.device_key}</p>
                    <p className={`text-2xl font-semibold tabular-nums ${config.color}`}>{d.health_score}</p>
                    <p className="text-xs text-muted-foreground">{config.label}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
