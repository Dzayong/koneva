"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pause, Play, QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeviceBehavior } from "@/components/devices/device-behavior";
import { DeviceApiKeyPanel } from "@/components/devices/device-api-key-panel";
import { DeviceEvents } from "@/components/devices/device-events";
import { DeviceProfileTab } from "@/components/devices/device-profile";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import { HealthBar } from "@/components/devices/health-bar";
import { HealthDetail } from "@/components/devices/health-detail";
import { QRCodeDialog } from "@/components/devices/qr-code-dialog";
import { MessageDetail, MessageRow, messageNumber } from "@/components/messages/message-item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useContactNames } from "@/hooks/use-contacts";
import { useDevice } from "@/hooks/use-device";
import { usePauseDevice, useReconnectDevice, useResumeDevice } from "@/hooks/use-devices";
import { usePermissions } from "@/hooks/use-me";
import { useMessages } from "@/hooks/use-messages";
import { useUrlFlag } from "@/hooks/use-url-flag";
import { formatDate, formatPhoneNumber } from "@/lib/utils";

export default function DeviceDetailPage(props: {
  params: Promise<{ deviceKey: string }>;
}) {
  const { deviceKey } = use(props.params);
  const { can } = usePermissions();
  const { data: device, isLoading } = useDevice(deviceKey);
  const { data: messages, isLoading: messagesLoading } = useMessages({
    device_key: deviceKey,
    limit: 20,
    offset: 0,
  });
  const contactNames = useContactNames();
  const pauseDevice = usePauseDevice();
  const resumeDevice = useResumeDevice();
  const reconnectDevice = useReconnectDevice();
  const [manualQrOpen, setManualQrOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const openMessage = messages?.data.find((m) => m.id === openId) ?? null;

  // A freshly created number lands here with ?connect=1: show the QR without another click.
  const connectRequested = useUrlFlag("connect");
  const [connectDismissed, setConnectDismissed] = useState(false);
  const canWriteDevice = can("devices:write");
  const qrOpen = manualQrOpen || (connectRequested && !connectDismissed && canWriteDevice && Boolean(device));
  const setQrOpen = (open: boolean) => {
    setManualQrOpen(open);
    if (!open) setConnectDismissed(true);
  };

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

  const canWrite = can("devices:write");
  const actions: Array<{ label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; show: boolean }> = [
    { label: "Pindai QR", icon: <QrCode className="h-4 w-4" />, onClick: () => setQrOpen(true), show: canWrite && device?.status === "pending_qr" },
    { label: "Coba sambungkan", icon: <RefreshCw className="h-4 w-4" />, onClick: () => reconnectDevice.mutate(deviceKey, { onSuccess: () => setQrOpen(true) }), disabled: reconnectDevice.isPending, show: canWrite && (device?.status === "offline" || device?.status === "error") },
    { label: "Jeda", icon: <Pause className="h-4 w-4" />, onClick: () => pauseDevice.mutate(deviceKey), disabled: pauseDevice.isPending, show: canWrite && device?.status === "online" },
    { label: "Lanjutkan", icon: <Play className="h-4 w-4" />, onClick: () => resumeDevice.mutate(deviceKey), disabled: resumeDevice.isPending, show: canWrite && device?.status === "paused" },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/devices">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Device
        </Link>
      </Button>

      {connectRequested && device?.status === "online" && !connectDismissed && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
          <p className="font-medium">Device tersambung. Langkah berikutnya:</p>
          <p className="mt-1">
            1. Minta penerima uji kirim <strong>MULAI</strong>/<strong>START</strong> ke nomor ini dari WhatsApp mereka.{" "}
            2. Setelah itu, <Link href="/developers/quickstart" className="font-medium underline underline-offset-4">kirim pesan uji di Mulai cepat</Link>.
          </p>
        </div>
      )}

      {device && (
        <section className="rounded-2xl border bg-card p-5 shadow-card" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Riwayat chat terbaru</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {device.history_sync_status === "syncing"
                  ? "WhatsApp sedang menyinkronkan ringkasan riwayat terbaru."
                  : device.history_sync_status === "paused"
                    ? "Sinkronisasi riwayat dijeda oleh WhatsApp."
                    : device.history_sync_status === "completed"
                      ? device.history_sync_completion_explicit
                        ? "Sinkronisasi riwayat terbaru terkonfirmasi selesai."
                        : "Sinkronisasi berhenti, tetapi WhatsApp tidak mengonfirmasi 100%."
                      : "Menunggu informasi sinkronisasi dari WhatsApp."}
                {device.history_sync_status !== "completed" && device.history_sync_progress != null && ` · ${device.history_sync_progress}%`}
                {device.history_sync_status === "completed" && device.history_sync_completion_explicit && " · 100%"}
              </p>
            </div>
            <span className="text-sm font-medium tabular-nums">
              {device.history_latest_message_at
                ? new Date(device.history_latest_message_at).toLocaleString("id-ID")
                : "Belum ada waktu pesan"}
            </span>
          </div>
          {device.history_sync_status === "syncing" && (
            <progress className="mt-4 h-2 w-full accent-primary" max={100} value={device.history_sync_progress ?? undefined} aria-label="Progres sinkronisasi riwayat" />
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            KONEVA hanya menyimpan waktu pesan terbaru yang tersinkron, bukan isi riwayat. Data ini bukan umur akun WhatsApp.
          </p>
        </section>
      )}

      {isLoading || !device ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-heading truncate">{device.label || deviceKey}</h2>
              <DeviceStatusBadge status={device.status} />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{deviceKey}</span>
              {" · "}
              {device.phone_number ? formatPhoneNumber(device.phone_number) : "Nomor belum diisi"}
              {" · "}
              {device.last_connected ? `Terakhir tersambung ${formatDate(device.last_connected)}` : "Belum pernah tersambung"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {actions.filter((a) => a.show).map((a) => (
              <Tooltip key={a.label}>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={a.label} onClick={a.onClick} disabled={a.disabled}>
                    {a.icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{a.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </header>
      )}

      {/* Inline stats: label over figure, no separate cards */}
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        {[
          ["Kesiapan", device ? <HealthBar key="h" score={device.health_score} /> : "—"],
          ["Terkirim", stats.sent],
          ["Sampai", stats.delivered],
          ["Dibaca", stats.read],
          ["Gagal", stats.failed],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="text-label">{label}</dt>
            <dd className="mt-1 text-2xl font-medium tabular-nums">
              {messagesLoading && label !== "Kesiapan" ? <Skeleton className="h-8 w-8" /> : value}
            </dd>
          </div>
        ))}
      </dl>

      <Tabs defaultValue="ringkasan">
        <TabsList>
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="perilaku">Perilaku pengiriman</TabsTrigger>
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="api-key">API key</TabsTrigger>
          <TabsTrigger value="riwayat">Riwayat status</TabsTrigger>
        </TabsList>

        <TabsContent value="ringkasan" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <section>
              <h3 className="text-heading mb-3 text-lg">Pesan terbaru</h3>
              <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
                {messagesLoading ? (
                  <Skeleton className="h-32 w-full rounded-none" />
                ) : messages && messages.data.length > 0 ? (
                  <ul>
                    {messages.data.map((message) => (
                      <MessageRow
                        key={message.id}
                        message={message}
                        contactName={contactNames.get(messageNumber(message).replace(/\D/g, ""))}
                        selected={openId === message.id}
                        onSelect={() => setOpenId(openId === message.id ? null : message.id)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">Belum ada pesan</p>
                )}
              </div>
              {openMessage && (
                <div className="mt-4 rounded-2xl border bg-card p-6 shadow-card">
                  <MessageDetail
                    message={openMessage}
                    contactName={contactNames.get(messageNumber(openMessage).replace(/\D/g, ""))}
                  />
                </div>
              )}
            </section>

            <aside className="rounded-2xl border bg-card p-5 shadow-card lg:sticky lg:top-6 lg:self-start">
              <HealthDetail deviceKey={deviceKey} />
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="perilaku" className="mt-6">
          <DeviceBehavior deviceKey={deviceKey} />
        </TabsContent>

        <TabsContent value="profil" className="mt-6">
          <DeviceProfileTab deviceKey={deviceKey} online={device?.status === "online"} canEdit={can("content:write")} />
        </TabsContent>

        <TabsContent value="api-key" className="mt-6">
          <DeviceApiKeyPanel deviceKey={deviceKey} deviceLabel={device?.label || deviceKey} />
        </TabsContent>

        <TabsContent value="riwayat" className="mt-6">
          <DeviceEvents deviceKey={deviceKey} />
        </TabsContent>
      </Tabs>

      <QRCodeDialog deviceKey={deviceKey} open={qrOpen} onOpenChange={setQrOpen} />
    </div>
  );
}
