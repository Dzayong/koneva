"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Pager } from "@/components/operator/pager";
import { SearchBox } from "@/components/operator/search-box";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOperatorSession, useOwnerWorkspaces } from "@/hooks/use-operator";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import { formatDate } from "@/lib/utils";

const LIMITS = [10, 20, 50] as const;
const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const PLANS = ["Trial", "Pelajar", "Asisten", "Tim UKM", "Bisnis CS"] as const;
const WS_STATUSES = [{ value: "", label: "Semua status" }, { value: "active", label: "Aktif" }, { value: "suspended", label: "Suspend" }] as const;

function WorkspaceList() {
  const { can } = useOperatorSession();
  const { params, set } = useSearchParamsState();
  const q = params.get("q") ?? "";
  const planFilter = params.get("plan") ?? "";
  const statusFilter = params.get("status") ?? "";
  const limit = LIMITS.includes(Number(params.get("limit")) as 10 | 20 | 50) ? Number(params.get("limit")) : 10;
  const offset = Number(params.get("offset") ?? 0) || 0;
  const list = useOwnerWorkspaces({ q: q || undefined, limit, offset, plan: planFilter || undefined, status: statusFilter || undefined }, can("owner:insights"));

  if (!can("owner:insights")) return <ForbiddenState text="Bagian ini hanya untuk pemilik sistem." />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="text-sm text-muted-foreground">Daftar seluruh workspace dengan metrik pemilik. Hanya baca.</p>
        {list.dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Diperbarui: {new Date(list.dataUpdatedAt).toLocaleString("id-ID")} · auto-refresh 60 detik</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={(v) => set({ q: v, offset: 0 })} placeholder="Cari nama workspace atau email pemilik" label="Cari workspace" />
        <select value={planFilter} onChange={(e) => set({ plan: e.target.value || undefined, offset: 0 })} aria-label="Filter paket" className="rounded-lg border bg-muted px-3 py-1.5 text-sm">
          <option value="">Semua paket</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => set({ status: e.target.value || undefined, offset: 0 })} aria-label="Filter status" className="rounded-lg border bg-muted px-3 py-1.5 text-sm">
          {WS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div role="group" aria-label="Jumlah per halaman" className="inline-flex rounded-lg border bg-muted p-1">
          {LIMITS.map((v) => (
            <button key={v} type="button" aria-pressed={limit === v} onClick={() => set({ limit: v === 10 ? undefined : v, offset: 0 })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${limit === v ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </div>
      {list.isLoading ? <LoadingBlock label="Memuat daftar workspace..." /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data || list.data.items.length === 0 ? (
        <EmptyState title="Tidak ada workspace" text="Tidak ada workspace yang cocok dengan pencarian." />
      ) : (
        <>
          {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Pemilik</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pesan 30 hari</TableHead>
                  <TableHead className="text-right">Device</TableHead>
                  <TableHead className="text-right">Anggota</TableHead>
                  <TableHead>Aktivitas terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell><Link href={`/operator/insights/workspaces/${w.id}`} className="font-medium text-primary underline underline-offset-2">{w.name}</Link></TableCell>
                    <TableCell className="text-sm">{w.owner?.name ?? "—"}</TableCell>
                    <TableCell>{w.subscription?.plan ?? "—"}</TableCell>
                    <TableCell><Badge variant={w.status === "active" ? "default" : w.status === "suspended" ? "destructive" : "secondary"}>{w.status || "—"}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(w.messages_30d)}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.device_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.member_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{w.last_activity ? formatDate(w.last_activity) : "Belum ada"}</TableCell>
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

export default function OwnerWorkspacesPage() { return <Suspense><WorkspaceList /></Suspense>; }
