"use client";

import { useMemo } from "react";
import {
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
};

export default function AnalyticsPage() {
  // Sampled from the latest page, same honest caveat as the main dashboard
  // chart — api-gateway has no aggregate/date-range analytics endpoint yet.
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
        <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
        <p className="text-muted-foreground">
          Sampled from the latest 100 messages — not a true historical aggregate (no
          date-range endpoint exists yet).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Message status breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : statusBreakdown.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No messages yet</p>
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
            <CardTitle>Delivery rate by device</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : deliveryRateByDevice.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No messages yet</p>
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
                  <Tooltip formatter={(v: unknown) => [`${String(v)}%`, "Delivery rate"]} />
                  <Bar dataKey="rate" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Device health scores</CardTitle>
        </CardHeader>
        <CardContent>
          {devicesLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !devices || devices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No devices yet</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {devices.map((d) => {
                const config = getHealthConfig(d.health_score);
                return (
                  <div key={d.id} className="rounded-lg border p-3 text-center">
                    <p className="truncate text-sm font-medium">{d.label || d.device_key}</p>
                    <p className={`text-2xl font-bold ${config.color}`}>{d.health_score}</p>
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
