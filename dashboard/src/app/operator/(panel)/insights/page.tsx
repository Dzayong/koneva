"use client";

import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorSession, useOwnerInsights } from "@/hooks/use-operator";

const number = (value: number) => new Intl.NumberFormat("id-ID").format(value);
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("id-ID") : "Belum ada data";

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return <Card><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{typeof value === "number" ? number(value) : value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</Card>;
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
    <div className="space-y-6">
      <header><h1 className="text-2xl font-semibold tracking-tight">Panel Pemilik</h1><p className="text-sm text-muted-foreground">Ringkasan platform read-only, diukur {dateTime(d.measured_at)}.</p></header>
      <section aria-label="Indikator bisnis" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Akun terdaftar" value={d.kpis.registered_accounts} />
        <Metric label="Workspace aktif" value={d.kpis.active_workspaces} />
        <Metric label="Workspace suspend" value={d.kpis.suspended_workspaces} />
        <Metric label="Pesan terkirim · 24 jam" value={d.kpis.messages_sent_24h} />
        <Metric label="Pesan terkirim · 30 hari" value={d.kpis.messages_sent_30d} />
        <Metric label="Percobaan kirim email OTP · hari ini (WIB)" value={d.kpis.otp_sender_today} hint={`Sisa batas internal: ${number(d.kpis.otp_sender_remaining_internal)} dari ${number(d.kpis.otp_sender_daily_cap)}; bukan kuota Gmail Google.`} />
      </section>
      <section className="space-y-3" aria-labelledby="health-title">
        <h2 id="health-title" className="text-lg font-semibold">Kesehatan layanan</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="API" value={d.health.api === "responding" ? "Merespons" : d.health.api} />
          <Metric label="Database" value={d.health.database === "connected" ? "Terhubung" : d.health.database} />
          <Metric label="Antrean pesan" value={number(d.health.queue.queued)} hint={`${number(d.health.queue.sending)} sedang dikirim`} />
          <Metric label="Gagal kirim · 24 jam" value={`${d.health.message_delivery_24h.error_rate_percent}%`} hint={`${number(d.health.message_delivery_24h.failed)} dari ${number(d.health.message_delivery_24h.attempted)} pesan`} />
        </div>
        <Card><h3 className="font-medium">Status device WhatsApp</h3>{d.health.devices.length ? <ul className="mt-3 divide-y">{d.health.devices.map((device) => <li key={device.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{device.workspace_name ?? "Workspace"} · {device.label}</span><span className="text-muted-foreground">{device.status} · diperbarui {dateTime(device.updated_at)}</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Belum ada device.</p>}<p className="mt-3 text-xs text-muted-foreground">Status diambil dari database; bukan pemeriksaan langsung ke proses/container bot.</p></Card>
      </section>
      <section className="space-y-3" aria-labelledby="alerts-title">
        <h2 id="alerts-title" className="text-lg font-semibold">Peringatan dan consent</h2>
        <Card><p className="font-medium">Ambang email OTP</p>{d.alerts.otp_thresholds.length ? <ul className="mt-2 space-y-1 text-sm">{d.alerts.otp_thresholds.map((a) => <li key={a.id}>{a.kind === "sender_cap_reached" ? "Batas harian tercapai" : "70% batas harian tercapai"} · {a.window_count}/{a.cap} · {dateTime(a.at)}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Tidak ada ambang tercatat dalam 30 hari.</p>}<p className="mt-3 text-sm">Permintaan STOP dalam 1 jam: <strong>{number(d.alerts.stop_events_last_hour)}</strong>. Pesan diblokir oleh pemeriksaan consent dalam 1 jam: <strong>{number(d.alerts.consent_blocked_messages_last_hour)}</strong>.</p><p className="mt-2 text-xs text-muted-foreground">Belum ada event persisten untuk penolakan consent sebelum antre, sehingga lonjakan penolakan itu belum dapat dihitung.</p></Card>
      </section>
      <section className="space-y-3" aria-labelledby="activity-title">
        <h2 id="activity-title" className="text-lg font-semibold">Aktivitas sistem · 30 hari</h2>
        <Card>{d.activity.length ? <ol className="divide-y">{d.activity.map((event) => <li key={`${event.kind}-${event.id}`} className="py-3"><p className="text-sm font-medium">{event.title}</p>{event.detail && <p className="text-sm text-muted-foreground">{event.detail}</p>}<time className="text-xs text-muted-foreground">{dateTime(event.at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">Belum ada aktivitas tersimpan untuk rentang ini.</p>}</Card>
      </section>
      <section className="space-y-2" aria-labelledby="limits-title"><h2 id="limits-title" className="text-lg font-semibold">Batas data yang tersedia</h2><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{d.data_limits.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
  );
}
