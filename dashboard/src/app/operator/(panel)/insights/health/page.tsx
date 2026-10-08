"use client";

import { AlertTriangle, CheckCircle2, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorSession, useSystemHealth } from "@/hooks/use-operator";

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const dateTime = (v: string | null) => v ? new Date(v).toLocaleString("id-ID") : "—";

function Stat({ label, value, detail, warn }: { label: string; value: string | number; detail?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${warn ? "text-destructive" : ""}`}>{typeof value === "number" ? fmt(value) : value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-sm text-muted-foreground">Belum tersedia</p>
      <p className="mt-1 text-xs text-muted-foreground">Fase A: data tidak tersedia</p>
    </div>
  );
}

export default function SystemHealthPage() {
  const { can } = useOperatorSession();
  const health = useSystemHealth(can("owner:insights"));

  if (!can("owner:insights")) return <ForbiddenState text="Bagian ini hanya untuk pemilik sistem." />;
  if (health.isLoading) return <LoadingBlock label="Memuat kesehatan sistem..." />;
  if (health.error || !health.data) return <ErrorState error={health.error} onRetry={() => void health.refetch()} />;
  const h = health.data;

  return (
    <div className="space-y-8 md:space-y-10">
      <header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-label text-primary">KESEHATAN SISTEM</p>
            <h1 className="text-display mt-2">Kondisi layanan</h1>
            <p className="mt-2 text-muted-foreground">Snapshot terbaru · diperbarui {dateTime(h.measured_at)}.</p>
          </div>
          <Badge variant="outline" className="w-fit gap-1.5 rounded-full bg-card px-3 py-1.5"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />Baca saja</Badge>
        </div>
      </header>

      <section aria-label="Antrean pesan" className="space-y-3">
        <h2 className="text-lg font-semibold">Antrean pesan</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Kedalaman antrean" value={h.queue.queued} detail={`${fmt(h.queue.sending)} sedang dikirim`} />
          <Stat label="Pesan tertua di antrean" value={h.queue.oldest_queued_at ? dateTime(h.queue.oldest_queued_at) : "Antrean kosong"} />
        </div>
      </section>

      <section aria-label="Status layanan" className="space-y-3">
        <h2 className="text-lg font-semibold">Status layanan</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="API" value={h.api_status === "responding" ? "Merespons" : h.api_status} />
          <Stat label="Database" value={h.db_status === "connected" ? "Terhubung" : h.db_status} />
          <Stat label="Transport email" value={h.email_transport} detail="Mode konfigurasi aktif" />
        </div>
      </section>

      <section aria-label="Error rate" className="space-y-3">
        <h2 className="text-lg font-semibold">Error rate pengiriman</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Error rate 1 jam" value={`${h.error_rate_1h.percent}%`} detail={`${fmt(h.error_rate_1h.failed)} dari ${fmt(h.error_rate_1h.attempted)} pesan`} warn={h.error_rate_1h.percent > 5} />
          <Stat label="Error rate 24 jam" value={`${h.error_rate_24h.percent}%`} detail={`${fmt(h.error_rate_24h.failed)} dari ${fmt(h.error_rate_24h.attempted)} pesan`} warn={h.error_rate_24h.percent > 5} />
        </div>
      </section>

      <section aria-label="OTP" className="space-y-3">
        <div><h2 className="text-lg font-semibold">Permintaan OTP</h2><p className="text-sm text-muted-foreground">Hitungan sender KONEVA terhadap batas internal harian · bukan kuota Google Gmail.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Permintaan OTP tercatat hari ini (WIB)" value={h.otp.today} detail={`Batas harian: ${fmt(h.otp.daily_cap)}`} />
          <Stat label="Sisa kuota internal" value={h.otp.remaining} />
        </div>
        {h.otp_alerts.length > 0 && (
          <Card className="shadow-card">
            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /><h3 className="font-semibold">Peringatan OTP (30 hari)</h3></div>
            <ul className="mt-3 space-y-2">{h.otp_alerts.map((a) => (
              <li key={a.id} className="rounded-lg bg-muted/60 p-3 text-sm">
                <p className="font-medium">{a.kind === "sender_cap_reached" ? "Batas harian tercapai" : "70% batas harian tercapai"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.window_count}/{a.cap} · {dateTime(a.at)}</p>
              </li>
            ))}</ul>
          </Card>
        )}
      </section>

      <section aria-label="Ambang device" className="space-y-3">
        <h2 className="text-lg font-semibold">Ambang penanda (§5)</h2>
        <p className="text-sm text-muted-foreground">Titik awal; dikalibrasi setelah observasi data produksi. Penanda saja, tanpa aksi otomatis.</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Reconnect > N/24 jam" value={h.thresholds.reconnect_24h} detail={`${fmt(h.threshold_devices.reconnect_exceeded)} device melewati`} warn={h.threshold_devices.reconnect_exceeded > 0} />
          <Stat label="Stream error > N/24 jam" value={h.thresholds.stream_error_24h} detail={`${fmt(h.threshold_devices.error_exceeded)} device melewati`} warn={h.threshold_devices.error_exceeded > 0} />
          <Stat label={`Rasio gagal > ${h.thresholds.fail_ratio_percent}%`} value={`min ${h.thresholds.fail_ratio_min_messages} pesan`} />
          <Stat label="Offline > N jam" value={h.thresholds.offline_hours} detail={`${fmt(h.threshold_devices.offline_exceeded)} device melewati`} warn={h.threshold_devices.offline_exceeded > 0} />
        </div>
      </section>

      <section aria-label="Belum tersedia" className="space-y-3">
        <h2 className="text-lg font-semibold">Belum tersedia (Fase A)</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Unavailable label="Konektivitas container/worker" />
          <Unavailable label="Riwayat downtime terlacak" />
        </div>
      </section>

      <section className="rounded-2xl border border-warning/30 bg-warning/5 p-5 md:p-6">
        <div className="flex items-start gap-3"><Server className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden /><div><h3 className="font-semibold">Batas data</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>OTP yang dihitung adalah hitungan sender KONEVA terhadap batas internal harian; bukan kuota Google Gmail.</li>
          <li>Ambang penanda bersifat observasional dan tidak memicu aksi otomatis.</li>
          <li>Konektivitas container dan riwayat downtime belum tersedia di Fase A.</li>
        </ul></div></div>
      </section>
    </div>
  );
}
