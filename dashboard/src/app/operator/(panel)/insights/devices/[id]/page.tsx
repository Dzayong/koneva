"use client";

import { use } from "react";
import { ArrowLeft, AlertTriangle, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, FieldList } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOperatorSession, useOwnerDevice } from "@/hooks/use-operator";
import { formatDate } from "@/lib/utils";

function healthVariant(badge: string): "default" | "secondary" | "outline" | "destructive" {
  if (badge === "OK") return "default";
  if (badge === "Perlu Perhatian") return "secondary";
  if (badge === "Bermasalah") return "destructive";
  return "outline";
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "baru saja";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam`;
  const days = Math.floor(hours / 24);
  return `${days} hari`;
}

function ExceedsBadge({ value, threshold, label }: { value: number; threshold: number; label: string }) {
  const exceeds = value > threshold;
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${exceeds ? "text-destructive" : ""}`}>{value}</span>
        {exceeds && <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Ambang: {threshold}</p>
    </div>
  );
}

export default function DeviceDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { can } = useOperatorSession();
  const device = useOwnerDevice(id, can("owner:insights"));

  if (!can("owner:insights")) return <ForbiddenState text="Bagian ini hanya untuk pemilik sistem." />;
  if (device.isLoading) return <LoadingBlock label="Memuat detail device..." />;
  if (device.error || !device.data) return <ErrorState error={device.error} onRetry={() => void device.refetch()} />;
  const d = device.data;
  const failExceeds = d.fail_ratio.percent !== null && d.fail_ratio.percent > d.thresholds.fail_ratio_percent;

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Kembali</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="break-words text-2xl font-semibold tracking-tight">{d.label}</h1>
          <p className="text-sm text-muted-foreground">{d.workspace.name} · Hanya baca</p>
          {device.dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Diperbarui: {new Date(device.dataUpdatedAt).toLocaleString("id-ID")} · auto-refresh 60 detik</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={d.status === "online" ? "default" : d.status === "error" || d.status === "banned" ? "destructive" : "secondary"}>{d.status_label}</Badge>
          <Badge variant={healthVariant(d.health_badge)}>{d.health_badge}</Badge>
        </div>
      </div>

      <Card title="Identitas">
        <FieldList items={[
          ["Workspace", d.workspace.name],
          ["Telepon (masking)", d.phone_masked ?? "—"],
          ["Terdaftar sejak", d.created_at ? formatDate(d.created_at) : "—"],
          ["Status", d.status_label],
          ["Durasi status", d.status_since ? timeSince(d.status_since) : "Tidak diketahui"],
          ["Health score", d.health_score !== null ? `${d.health_score}/100` : "—"],
        ]} />
        <p className="mt-3 text-xs text-muted-foreground">Health score: freshness tidak diketahui (tidak ada timestamp kalkulasi terakhir).</p>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sinyal §5</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ExceedsBadge value={d.reconnect_24h} threshold={d.thresholds.reconnect_24h} label="Reconnect 24 jam" />
          <ExceedsBadge value={d.stream_error_24h} threshold={d.thresholds.stream_error_24h} label="Stream error 24 jam" />
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Rasio gagal (24 jam)</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-semibold tabular-nums ${failExceeds ? "text-destructive" : ""}`}>{d.fail_ratio.percent !== null ? `${d.fail_ratio.percent}%` : "—"}</span>
              {failExceeds && <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{d.fail_ratio.failed}/{d.fail_ratio.attempted} pesan · Ambang: {d.thresholds.fail_ratio_percent}% (min {d.thresholds.fail_ratio_min_messages} pesan)</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Konektivitas container</p>
            <p className="mt-2 text-sm text-muted-foreground">Belum tersedia</p>
            <p className="mt-1 text-xs text-muted-foreground">Fase A: data tidak tersedia</p>
          </div>
        </div>
      </section>

      <Card title="Riwayat event (10 terakhir)">
        {d.events.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada event tercatat.</p> : (
          <>
          <div className="space-y-3 md:hidden">
            {d.events.map((e) => (
              <article key={e.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={e.status === "online" ? "default" : e.status === "error" || e.status === "banned" ? "destructive" : "secondary"}>{e.status_label}</Badge>
                  <time className="text-xs text-muted-foreground">{formatDate(e.at)}</time>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{e.previous_status_label ? `Sebelumnya: ${e.previous_status_label}` : "Status awal tidak diketahui"}</p>
                <p className="mt-1 break-words">{e.reason_label}</p>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Status sebelumnya</TableHead>
                  <TableHead>Status baru</TableHead>
                  <TableHead>Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{formatDate(e.at)}</TableCell>
                    <TableCell>{e.previous_status_label ?? "—"}</TableCell>
                    <TableCell><Badge variant={e.status === "online" ? "default" : e.status === "error" || e.status === "banned" ? "destructive" : "secondary"}>{e.status_label}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.reason_label}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        )}
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Server className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Status diambil dari database. Bukan pemeriksaan langsung ke proses/container bot.</p>
    </div>
  );
}
