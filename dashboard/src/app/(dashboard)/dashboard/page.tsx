"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ContactRound, MessageSquare, Smartphone, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatGrid, StatsCard } from "@/components/dashboard/stats-card";
import { MessagesChart } from "@/components/dashboard/messages-chart";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { usePermissions } from "@/hooks/use-me";
import { useDevices } from "@/hooks/use-devices";
import { useDashboardStats } from "@/hooks/use-messages";
import { useContacts } from "@/hooks/use-contacts";
import { useBilling } from "@/hooks/use-billing";

export default function DashboardPage() {
  const { user, can } = usePermissions();
  const { data: devices, isLoading: devicesLoading } = useDevices();
  const { data: stats, isLoading: statsLoading, isError: statsError } = useDashboardStats();
  const canReadContacts = can("messages:read");
  const { data: contacts, isLoading: contactsLoading } = useContacts({ limit: 1, offset: 0 }, canReadContacts);
  const canReadBilling = can("billing:manage");
  const { data: billing, isLoading: billingLoading } = useBilling();

  const onlineDevices = useMemo(
    () => devices?.filter((d) => d.status === "online").length ?? 0,
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

      {canReadBilling && <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{billingLoading || billing?.wallet.enabled ? "Saldo" : "Ringkasan paket"}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {billing?.wallet.enabled
                ? "Pantau saldo dan biaya pesan workspace."
                : "Pemakaian paket workspace saat ini."}
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/billing">
              {billing?.wallet.enabled ? "Isi saldo" : "Buka tagihan"}
              {billing?.wallet.enabled ? <Wallet className="ml-2 h-4 w-4" /> : <ArrowRight className="ml-2 h-4 w-4" />}
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {billingLoading ? <div className="h-16 animate-pulse rounded-lg bg-muted" aria-label="Memuat ringkasan paket" /> : billing ? (
            billing.wallet.enabled ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Saldo tersedia</p>
                  <p className="mt-1 text-xl font-semibold">Rp {billing.wallet.available_idr.toLocaleString("id-ID")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pesan dikenai biaya</p>
                  <p className="mt-1 text-xl font-semibold">{billing.wallet.messages_charged.toLocaleString("id-ID")} pesan</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total terpakai</p>
                  <p className="mt-1 text-xl font-semibold">Rp {billing.wallet.spent_idr.toLocaleString("id-ID")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tarif per pesan</p>
                  <p className="mt-1 text-xl font-semibold">Rp {(billing.wallet.price_per_message_idr ?? 0).toLocaleString("id-ID")}</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <div><p className="text-xs text-muted-foreground">Paket aktif</p><p className="mt-1 font-semibold">{billing.subscription?.plan_name ?? "Belum ada paket aktif"}</p></div>
                <div><p className="text-xs text-muted-foreground">Pesan bulan ini</p><p className="mt-1 font-semibold">{billing.usage.quota_headline ?? `${billing.usage.messages_used.toLocaleString("id-ID")} / ${billing.usage.messages_limit.toLocaleString("id-ID")}`}</p>{billing.usage.quota_note && <p className="mt-1 text-xs text-muted-foreground">{billing.usage.quota_note}</p>}</div>
                <div><p className="text-xs text-muted-foreground">Nomor terpakai</p><p className="mt-1 font-semibold">{billing.usage.devices_used} / {billing.usage.devices_limit}</p></div>
              </div>
            )
          ) : <p className="text-sm text-muted-foreground">Ringkasan paket tidak dapat dimuat.</p>}
        </CardContent>
      </Card>}

      <QuickActions />
      <SetupChecklist />

      <StatGrid>
        <StatsCard
          title="Jumlah device"
          index={0}
          value={devices?.length ?? 0}
          icon={Smartphone}
          description={`${onlineDevices} online · ${Math.max(0, (devices?.length ?? 0) - onlineDevices)} offline`}
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
          title="Kontak tersimpan"
          index={3}
          value={canReadContacts ? contacts?.pagination.total ?? 0 : "—"}
          icon={ContactRound}
          description={canReadContacts ? "Kontak di workspace ini" : "Tidak tersedia untuk peran ini"}
          isLoading={canReadContacts && contactsLoading}
        />
      </StatGrid>

      <MessagesChart />
    </div>
  );
}
