"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pause, Play, QrCode, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import { HealthBar } from "@/components/devices/health-bar";
import { QRCodeDialog } from "@/components/devices/qr-code-dialog";
import { MessageStatusBadge } from "@/components/messages/message-status-badge";
import { useDevice } from "@/hooks/use-device";
import { usePauseDevice, useResumeDevice } from "@/hooks/use-devices";
import { useMessages } from "@/hooks/use-messages";
import { formatDate, formatPhoneNumber, truncate } from "@/lib/utils";

export default function DeviceDetailPage(props: {
  params: Promise<{ deviceKey: string }>;
}) {
  const { deviceKey } = use(props.params);
  const { data: device, isLoading } = useDevice(deviceKey);
  const { data: messages, isLoading: messagesLoading } = useMessages({
    device_key: deviceKey,
    limit: 20,
    offset: 0,
  });
  const pauseDevice = usePauseDevice();
  const resumeDevice = useResumeDevice();
  const [qrOpen, setQrOpen] = useState(false);

  const stats = (messages?.data ?? []).reduce(
    (acc, m) => {
      if (m.status === "sent") acc.sent += 1;
      if (m.status === "delivered") acc.delivered += 1;
      if (m.status === "read") acc.read += 1;
      if (m.status === "failed" || m.status === "blocked") acc.failed += 1;
      return acc;
    },
    { sent: 0, delivered: 0, read: 0, failed: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/devices">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {isLoading ? <Skeleton className="h-7 w-40" /> : device?.label || deviceKey}
          </h2>
          <p className="text-sm text-muted-foreground">{deviceKey}</p>
        </div>
      </div>

      {isLoading || !device ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Device Info</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Phone Number</p>
                <p className="font-medium">
                  {device.phone_number ? formatPhoneNumber(device.phone_number) : "Not set"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <DeviceStatusBadge status={device.status} />
              </div>
              <div>
                <p className="text-muted-foreground">Health Score</p>
                <HealthBar score={device.health_score} />
              </div>
              <div>
                <p className="text-muted-foreground">Last Connected</p>
                <p className="font-medium">
                  {device.last_connected ? formatDate(device.last_connected) : "Never"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {device.status === "pending_qr" && (
                <Button className="w-full" variant="outline" onClick={() => setQrOpen(true)}>
                  <QrCode className="mr-2 h-4 w-4" />
                  Show QR Code
                </Button>
              )}
              {device.status === "online" ? (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => pauseDevice.mutate(deviceKey)}
                  disabled={pauseDevice.isPending}
                >
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </Button>
              ) : device.status === "paused" ? (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => resumeDevice.mutate(deviceKey)}
                  disabled={resumeDevice.isPending}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Resume
                </Button>
              ) : null}
              <Button
                className="w-full"
                variant="outline"
                onClick={() =>
                  toast.info("Not available yet", {
                    description: "There's no restart endpoint on the backend yet.",
                  })
                }
              >
                <RotateCw className="mr-2 h-4 w-4" />
                Restart
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <div>
        <h3 className="mb-4 text-lg font-semibold">Message Stats</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatBox label="Sent" value={stats.sent} loading={messagesLoading} />
          <StatBox label="Delivered" value={stats.delivered} loading={messagesLoading} />
          <StatBox label="Read" value={stats.read} loading={messagesLoading} />
          <StatBox label="Failed" value={stats.failed} loading={messagesLoading} />
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="mb-4 text-lg font-semibold">Recent Messages</h3>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messagesLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : messages && messages.data.length > 0 ? (
                messages.data.map((message) => (
                  <TableRow key={message.id}>
                    <TableCell>{formatPhoneNumber(message.to_number)}</TableCell>
                    <TableCell className="max-w-xs">{truncate(message.content, 60)}</TableCell>
                    <TableCell>
                      <MessageStatusBadge status={message.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(message.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    No messages yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <QRCodeDialog deviceKey={deviceKey} open={qrOpen} onOpenChange={setQrOpen} />
    </div>
  );
}

function StatBox({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
