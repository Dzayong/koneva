"use client";

import { Activity, AlertTriangle, Building2, CheckCircle2, CirclePause, Mail, MessageSquare, Server, Smartphone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { StatGrid, StatsCard } from "@/components/dashboard/stats-card";
import { useOperatorSession, useOwnerInsights } from "@/hooks/use-operator";

const number = (value: number) => new Intl.NumberFormat("id-ID").format(value);
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("id-ID") : "Belum ada data";

function Snapshot({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="rounded-xl border bg-card p-4 shadow-card"><p className="text-label">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>;
}

export default function OwnerInsightsPage() {
  const session = useOperatorSession();
  const insights = useOwnerInsights(session.can("owner:insights"));
  if (session.isLoading || insights.isLoading) return <LoadingBlock label="Memuat ringkasan pemilik…" />;
  if (!session.can("owner:insights")) return <ForbiddenState text="Bagian ini hanya untuk pemilik sistem." />;
  if (insights.error) return <ErrorState error={insights.error} onRetry={() => void insights.refetch()} />;
  if (!insights.data) return <p role="status">Data ringkasan belum tersedia.</p>;

  const d = insights.data;
  return (
    <div className="space-y-8 md:space-y-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-label text-primary">PANEL PEMILIK</p>
          <h2 className="text-display mt-2">Ringkasan bisnis</h2>
          <p className="mt-2 text-muted-foreground">Kondisi platform saat ini · diperbarui {dateTime(d.measured_at)}.</p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5 rounded-full bg-card px-3 py-1.5"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />Baca saja</Badge>
      </header>

      <section aria-label="Indikator bisnis" className="space-y-3">
        <div><h3 className="text-lg font-semibold">Kinerja platform</h3><p className="text-sm text-muted-foreground">Angka utama dari data tersimpan.</p></div>
        <StatGrid>
          <StatsCard title="Akun terdaftar" value={number(d.kpis.registered_accounts)} icon={Users} description="Total akun" index={0} />
          <StatsCard title="Workspace aktif" value={number(d.kpis.active_workspaces)} icon={Building2} description="Berstatus aktif" index={1} />
          <StatsCard title="Workspace suspend" value={number(d.kpis.suspended_workspaces)} icon={CirclePause} description="Berstatus suspend" index={2} />
          <StatsCard title="Pesan terkirim · 24 jam" value={number(d.kpis.messages_sent_24h)} icon={MessageSquare} description="Terkirim, delivered, atau read" index={3} />
          <StatsCard title="Pesan terkirim · 30 hari" value={number(d.kpis.messages_sent_30d)} icon={MessageSquare} description="Terkirim, delivered, atau read" index={4} />
          <StatsCard title="Email OTP · hari ini (WIB)" value={number(d.kpis.otp_sender_today)} icon={Mail} description={`Sisa batas internal: ${number(d.kpis.otp_sender_remaining_internal)} dari ${number(d.kpis.otp_sender_daily_cap)}; bukan kuota Gmail Google.`} index={5} />
        </StatGrid>
      </section>

      <section aria-labelledby="health-title" className="space-y-3">
        <div><h3 id="health-title" className="text-lg font-semibold">Kesehatan layanan</h3><p className="text-sm text-muted-foreground">Snapshot terbaru dari API dan database.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Snapshot label="API" value="Merespons" detail="Permintaan ringkasan berhasil" />
          <Snapshot label="Database" value="Terhubung" detail="Query ringkasan berhasil" />
          <Snapshot label="Antrean pesan" value={number(d.health.queue.queued)} detail={`${number(d.health.queue.sending)} sedang dikirim`} />
          <Snapshot label="Error pengiriman · 24 jam" value={`${d.health.message_delivery_24h.error_rate_percent}%`} detail={`${number(d.health.message_delivery_24h.failed)} dari ${number(d.health.message_delivery_24h.attempted)} pesan`} />
        </div>
        <Card className="shadow-card">
          <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" aria-hidden /><h4 className="font-semibold">Device WhatsApp</h4></div>
          {d.health.devices.length ? <ul className="mt-3 divide-y">{d.health.devices.map((device) => <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0 font-medium">{device.workspace_name ?? "Workspace"} · {device.label}</span><span className="text-muted-foreground">{device.status} · {dateTime(device.updated_at)}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Belum ada device.</p>}
          <p className="mt-3 text-xs text-muted-foreground">Status diambil dari database, bukan pemeriksaan langsung ke proses/container bot.</p>
        </Card>
      </section>

      <div className="grid gap-5 xl:grid-cols-5 xl:gap-6">
        <section aria-labelledby="activity-title" className="space-y-3 xl:col-span-3">
          <div className="flex items-end justify-between gap-3"><div><h3 id="activity-title" className="text-lg font-semibold">Aktivitas sistem</h3><p className="text-sm text-muted-foreground">Peristiwa tersimpan dalam 30 hari.</p></div><Activity className="h-5 w-5 text-primary" aria-hidden /></div>
          <Card className="shadow-card">{d.activity.length ? <ol className="divide-y">{d.activity.map((event) => <li key={`${event.kind}-${event.id}`} className="flex gap-3 py-4 first:pt-1 last:pb-1"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden /><div className="min-w-0"><p className="text-sm font-medium">{event.title}</p>{event.detail && <p className="mt-0.5 text-sm text-muted-foreground">{event.detail}</p>}<time className="mt-1 block text-xs text-muted-foreground">{dateTime(event.at)}</time></div></li>)}</ol> : <p className="text-sm text-muted-foreground">Belum ada aktivitas tersimpan untuk rentang ini.</p>}</Card>
        </section>

        <section aria-labelledby="alerts-title" className="space-y-3 xl:col-span-2">
          <div><h3 id="alerts-title" className="text-lg font-semibold">Peringatan</h3><p className="text-sm text-muted-foreground">Ambang OTP dan sinyal consent.</p></div>
          <Card className="shadow-card">
            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /><h4 className="font-semibold">Ambang email OTP</h4></div>
            {d.alerts.otp_thresholds.length ? <ul className="mt-3 space-y-2">{d.alerts.otp_thresholds.map((a) => <li key={a.id} className="rounded-lg bg-muted/60 p-3 text-sm"><p className="font-medium">{a.kind === "sender_cap_reached" ? "Batas harian tercapai" : "70% batas harian tercapai"}</p><p className="mt-0.5 text-xs text-muted-foreground">{a.window_count}/{a.cap} · {dateTime(a.at)}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Tidak ada ambang tercatat dalam 30 hari.</p>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><Snapshot label="Permintaan STOP · 1 jam" value={number(d.alerts.stop_events_last_hour)} /><Snapshot label="Pesan diblokir consent · 1 jam" value={number(d.alerts.consent_blocked_messages_last_hour)} /></div>
            {d.alerts.break_glass_validation.configured && <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${d.alerts.break_glass_validation.due ? "bg-destructive/10 text-destructive" : "bg-muted/60 text-muted-foreground"}`}>{d.alerts.break_glass_validation.due ? "Akun darurat perlu validasi login sekarang (maksimal setiap 90 hari)." : `Validasi akun darurat terakhir: ${d.alerts.break_glass_validation.last_validated_at ? dateTime(d.alerts.break_glass_validation.last_validated_at) : "belum tercatat"}.`}</p>}
            <p className="mt-3 text-xs text-muted-foreground">Penolakan consent sebelum pesan masuk antrean belum tersimpan sebagai event.</p>
          </Card>
        </section>
      </div>

      <section aria-labelledby="limits-title" className="rounded-2xl border border-warning/30 bg-warning/5 p-5 md:p-6">
        <div className="flex items-start gap-3"><Server className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden /><div><h3 id="limits-title" className="font-semibold">Batas data yang tersedia</h3><ul className="mt-3 grid gap-x-8 gap-y-2 text-sm text-muted-foreground md:grid-cols-2">{d.data_limits.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
      </section>
    </div>
  );
}
