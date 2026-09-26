"use client";

import { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, isAfter, isSameDay, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages } from "@/hooks/use-messages";

const DAYS = 7;

export function MessagesChart() {
  const reduceMotion = useReducedMotion();
  // api-gateway has no date-range filter yet, so this samples the latest
  // page of messages and buckets it client-side — accurate for the last
  // `limit` messages, not a true 7-day aggregate for high-volume tenants.
  const { data, isLoading } = useMessages({ limit: 100, offset: 0 });

  const chartData = useMemo(() => {
    const since = subDays(new Date(), DAYS - 1);
    const buckets = new Map<string, number>();
    for (let i = 0; i < DAYS; i++) {
      const day = subDays(new Date(), DAYS - 1 - i);
      buckets.set(format(day, "MMM d"), 0);
    }

    for (const message of data?.data ?? []) {
      const createdAt = new Date(message.created_at);
      if (isAfter(createdAt, since) || isSameDay(createdAt, since)) {
        const key = format(createdAt, "MMM d");
        if (buckets.has(key)) {
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
      }
    }

    return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
  }, [data]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Messages (last 7 days)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={256}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="2 4" className="stroke-border" />
              <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.75rem",
                  color: "var(--popover-foreground)",
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--primary)"
                fill="var(--primary)"
                fillOpacity={0.12}
                strokeWidth={1.5}
                isAnimationActive={!reduceMotion}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
