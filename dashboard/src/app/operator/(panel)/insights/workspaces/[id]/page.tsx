"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, FieldList } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOperatorSession, useOwnerWorkspace } from "@/hooks/use-operator";
import { formatDate } from "@/lib/utils";

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const fmtRp = (n: number) => `Rp${new Intl.NumberFormat("id-ID").format(n)}`;

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground tabular-nums">{fmt(used)}{limit ? ` / ${fmt(limit)}` : ""}</span></div>
      {limit ? <Progress value={pct} aria-label={label} /> : null}
    </div>
  );
}

function healthVariant(badge: string): "default" | "secondary" | "outline" | "destructive" {
  if (badge === "OK") return "default";
  if (badge === "Perlu Perhatian") return "secondary";
  if (badge === "Bermasalah") return "destructive";
  return "outline";
}

export default function OwnerWorkspaceDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { can } = useOperatorSession();
  const ws = useOwnerWorkspace(id, can("owner:insights"));

  if (!can("owner:insights")) return <ForbiddenState text="Bagian ini hanya untuk pemilik sistem." />;
  if (ws.isLoading) return <LoadingBlock label="Memuat detail workspace..." />;
  if (ws.error || !ws.data) return <ErrorState error={ws.error} onRetry={() => void ws.refetch()} />;
  const w = ws.data;
  const sub = w.subscription as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Kembali</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{w.name}</h1>
          <p className="text-sm text-muted-foreground">Hanya baca · Data pemilik</p>
          {ws.dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Diperbarui: {new Date(ws.dataUpdatedAt).toLocaleString("id-ID")} · auto-refresh 60 detik</p>}
        </div>
        <Badge variant={w.status === "active" ? "default" : w.status === "suspended" ? "destructive" : "secondary"}>{w.status || "—"}</Badge>
      </div>

      <Card title="Identitas">
        <FieldList items={[
          ["Pemilik", w.owner ? `${w.owner.name} (${w.owner.email})` : "—"],
          ["Status", w.status || "—"],
          ["Tanggal daftar", w.created_at ? formatDate(w.created_at) : "—"],
          ["Status pelajar", w.student?.status ?? "Tidak ada pengajuan"],
        ]} />
      </Card>

      <Card title="Langganan">
        {sub ? (
          <FieldList items={[
            ["Paket", String((sub["plan"] as Record<string, unknown>)?.["name"] ?? sub["plan"] ?? "—")],
            ["Status", String(sub["status"] ?? "—")],
            ["Siklus", sub["cycle"] === "yearly" ? "Tahunan" : sub["cycle"] === "monthly" ? "Bulanan" : "—"],
            ["Periode", sub["period_start"] && sub["period_end"] ? `${formatDate(String(sub["period_start"]))} sampai ${formatDate(String(sub["period_end"]))}` : "—"],
          ]} />
        ) : <p className="text-sm text-muted-foreground">Belum ada langganan.</p>}
      </Card>

      <Card title="Pemakaian">
        <div className="grid gap-4 sm:grid-cols-2">
          <Usage label="Pesan (kuota)" used={w.used_messages} limit={w.quota_messages} />
          <Usage label="Device" used={w.device_count} limit={w.max_devices} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pesan terkirim 30 hari</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{fmt(w.messages_30d)}</p>
          </div>
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Aktivitas sistem terakhir yang tercatat</p>
            <p className="mt-1 text-sm">{w.last_activity ? formatDate(w.last_activity) : "Belum ada aktivitas"}</p>
          </div>
        </div>
      </Card>

      <Card title={`Anggota tim (${w.members.length})`}>
        {w.members.length > 0 ? (
          <>
          <div className="space-y-3 md:hidden">
            {w.members.map((m, i) => (
              <article key={i} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words font-medium">{m.name}</p><Badge className="shrink-0" variant="secondary">{m.role}</Badge></div>
                <p className="mt-1 break-all text-muted-foreground">{m.email}</p>
                <p className="mt-2 text-xs text-muted-foreground">Bergabung {m.joined_at ? formatDate(m.joined_at) : "—"}</p>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Bergabung</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {w.members.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-sm">{m.email}</TableCell>
                    <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.joined_at ? formatDate(m.joined_at) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        ) : <p className="text-sm text-muted-foreground">Belum ada anggota.</p>}
      </Card>

      {w.devices.length > 0 && (
        <Card title="Device">
          <div className="space-y-3 md:hidden">
            {w.devices.map((d) => (
              <article key={d.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                <div className="min-w-0"><Link href={`/operator/insights/devices/${d.id}`} className="break-words font-medium text-primary underline underline-offset-2">{d.label}</Link><p className="mt-1 text-xs text-muted-foreground">Device workspace</p></div>
                <div className="flex shrink-0 flex-col items-end gap-2"><Badge variant={d.status === "online" ? "default" : d.status === "error" || d.status === "banned" ? "destructive" : "secondary"}>{d.status_label}</Badge><Badge variant={healthVariant(d.health_badge)}>{d.health_badge}</Badge></div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Kesehatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {w.devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><Link href={`/operator/insights/devices/${d.id}`} className="text-primary underline underline-offset-2">{d.label}</Link></TableCell>
                    <TableCell><Badge variant={d.status === "online" ? "default" : d.status === "error" || d.status === "banned" ? "destructive" : "secondary"}>{d.status_label}</Badge></TableCell>
                    <TableCell><Badge variant={healthVariant(d.health_badge)}>{d.health_badge}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Card title="Riwayat pembayaran">
        {w.recent_payments.length > 0 ? (
          <>
          <div className="space-y-3 md:hidden">
            {w.recent_payments.map((p) => (
              <article key={p.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-all font-mono text-xs font-medium">{p.number}</p><Badge className="shrink-0" variant={p.status === "paid" ? "default" : p.status === "void" ? "secondary" : "outline"}>{p.status}</Badge></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                  <div><dt className="text-xs text-muted-foreground">Paket</dt><dd className="mt-0.5">{p.plan_name ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Siklus</dt><dd className="mt-0.5">{p.cycle === "yearly" ? "Tahunan" : p.cycle === "monthly" ? "Bulanan" : "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Jumlah</dt><dd className="mt-0.5 tabular-nums">{fmtRp(p.amount_idr)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Tanggal</dt><dd className="mt-0.5">{p.paid_at ? formatDate(p.paid_at) : p.created_at ? formatDate(p.created_at) : "—"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Invoice</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Siklus</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {w.recent_payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.number}</TableCell>
                    <TableCell>{p.plan_name ?? "—"}</TableCell>
                    <TableCell>{p.cycle === "yearly" ? "Tahunan" : p.cycle === "monthly" ? "Bulanan" : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtRp(p.amount_idr)}</TableCell>
                    <TableCell><Badge variant={p.status === "paid" ? "default" : p.status === "void" ? "secondary" : "outline"}>{p.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.paid_at ? formatDate(p.paid_at) : p.created_at ? formatDate(p.created_at) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        ) : <p className="text-sm text-muted-foreground">Belum ada riwayat pembayaran.</p>}
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Panel ini tidak menampilkan kunci API, secret webhook, kredensial, kode QR, sesi WhatsApp, atau isi pesan, dan tidak punya aksi terhadap workspace.</p>
    </div>
  );
}
