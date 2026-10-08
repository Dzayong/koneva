"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Pager } from "@/components/operator/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useOperatorSession, useOwnerDevices, useOwnerWorkspaces } from "@/hooks/use-operator";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import { formatDate } from "@/lib/utils";

const LIMITS = [10, 20, 50] as const;

function healthVariant(badge: string): "default" | "secondary" | "outline" | "destructive" {
  if (badge === "OK") return "default";
  if (badge === "Perlu Perhatian") return "secondary";
  if (badge === "Bermasalah") return "destructive";
  return "outline";
}

const STATUSES = [
  { value: "", label: "Semua" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "error", label: "Error" },
  { value: "banned", label: "Diblokir" },
  { value: "paused", label: "Dijeda" },
  { value: "starting", label: "Memulai" },
  { value: "pending_qr", label: "Menunggu QR" },
] as const;

const SORTABLE_COLUMNS = [
  { key: "label", label: "Device" },
  { key: "workspace", label: "Workspace" },
  { key: "status", label: "Status" },
  { key: "health", label: "Kesehatan" },
  { key: "created_at", label: "Terdaftar sejak" },
] as const;

function SortHeader({ column, current, onSort }: { column: string; current: string; onSort: (col: string) => void }) {
  const active = current === column || current === `-${column}`;
  const desc = current === `-${column}`;
  return (
    <button type="button" onClick={() => onSort(active && !desc ? `-${column}` : column)} className="inline-flex items-center gap-1 hover:text-foreground">
      {active ? (desc ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />}
    </button>
  );
}

function DeviceList() {
  const { can } = useOperatorSession();
  const { params, set } = useSearchParamsState();
  const limit = LIMITS.includes(Number(params.get("limit")) as 10 | 20 | 50) ? Number(params.get("limit")) : 10;
  const offset = Number(params.get("offset") ?? 0) || 0;
  const status = params.get("status") ?? "";
  const workspace = params.get("workspace") ?? "";
  const sort = params.get("sort") ?? "";
  const since = params.get("since") ?? "";
  const attention = params.get("attention") === "1";
  const list = useOwnerDevices({ limit, offset, status: status || undefined, workspace: workspace || undefined, sort: sort || undefined, since: since || undefined, attention }, can("owner:insights"));
  const workspaces = useOwnerWorkspaces({ limit: 50 }, can("owner:insights"));

  if (!can("owner:insights")) return <ForbiddenState text="Bagian ini hanya untuk pemilik sistem." />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Device Monitor</h1>
        <p className="text-sm text-muted-foreground">Semua device WhatsApp terdaftar. Status diambil dari database, bukan pemeriksaan langsung ke container.</p>
        {attention && <p role="status" className="text-sm text-warning">Filter: device yang memerlukan perhatian</p>}
        {list.dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Diperbarui: {new Date(list.dataUpdatedAt).toLocaleString("id-ID")} · auto-refresh 60 detik</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter status" className="inline-flex flex-wrap rounded-lg border bg-muted p-1">
          {STATUSES.map((s) => (
            <button key={s.value} type="button" aria-pressed={status === s.value} onClick={() => set({ status: s.value || undefined, offset: 0 })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === s.value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{s.label}</button>
          ))}
        </div>
        <select value={workspace} onChange={(e) => set({ workspace: e.target.value || undefined, offset: 0 })} aria-label="Filter workspace" className="rounded-lg border bg-muted px-3 py-1.5 text-sm">
          <option value="">Semua workspace</option>
          {workspaces.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">Terdaftar sejak: <input type="date" value={since} onChange={(e) => set({ since: e.target.value || undefined, offset: 0 })} aria-label="Filter tanggal terdaftar" className="rounded-lg border bg-muted px-3 py-1.5 text-sm" /></label>
        <span className="text-sm text-muted-foreground">Per halaman:</span>
        <div role="group" aria-label="Jumlah per halaman" className="inline-flex rounded-lg border bg-muted p-1">
          {LIMITS.map((v) => (
            <button key={v} type="button" aria-pressed={limit === v} onClick={() => set({ limit: v === 10 ? undefined : v, offset: 0 })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${limit === v ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </div>
      {list.isLoading ? <LoadingBlock label="Memuat daftar device..." /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data || list.data.items.length === 0 ? (
        <EmptyState title="Tidak ada device" text="Tidak ada device yang cocok dengan filter saat ini." />
      ) : (
        <>
          {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  {SORTABLE_COLUMNS.map((col) => (
                    <TableHead key={col.key}><span className="inline-flex items-center gap-1">{col.label} <SortHeader column={col.key} current={sort} onSort={(s) => set({ sort: s === "status" ? undefined : s, offset: 0 })} /></span></TableHead>
                  ))}
                  <TableHead>Durasi</TableHead>
                  <TableHead>Telepon</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><Link href={`/operator/insights/devices/${d.id}`} className="font-medium text-primary underline underline-offset-2">{d.label}</Link></TableCell>
                    <TableCell>{d.workspace.name}</TableCell>
                    <TableCell><Badge variant={d.status === "online" ? "default" : d.status === "error" || d.status === "banned" ? "destructive" : "secondary"}>{d.status_label}</Badge></TableCell>
                    <TableCell><Badge variant={healthVariant(d.health_badge)}>{d.health_badge}</Badge></TableCell>
                    <TableCell>{d.created_at ? formatDate(d.created_at) : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.status_since ? timeSince(d.status_since) : "—"}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{d.phone_masked ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager pagination={list.data.pagination} onOffset={(o) => set({ offset: o })} busy={list.isFetching} />
        </>
      )}
    </div>
  );
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

export default function DeviceMonitorPage() { return <Suspense><DeviceList /></Suspense>; }
