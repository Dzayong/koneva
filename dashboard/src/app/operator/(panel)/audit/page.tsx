"use client";

import { Suspense } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Pager } from "@/components/operator/pager";
import { SearchBox } from "@/components/operator/search-box";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAudit, useOperatorSession } from "@/hooks/use-operator";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import type { AuditEntry } from "@/lib/operator/types";
import { wibDayEndExclusiveUtc, wibDayStartUtc } from "@/lib/operator/dates";
import { formatDate } from "@/lib/utils";

const clip = (v: string | number | boolean | null): string => (v === null ? "—" : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v));

function targetLink(t: NonNullable<AuditEntry["target"]>): string | null {
  if (!t.id) return null;
  if (t.type === "invoice") return `/operator/payments/${t.id}`;
  if (t.type === "student_request") return `/operator/students/${t.id}`;
  if (t.type === "workspace") return `/operator/workspaces/${t.id}`;
  return null;
}

function AuditList() {
  const { can } = useOperatorSession();
  const { params, set } = useSearchParamsState();
  const action = params.get("action") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const offset = Number(params.get("offset") ?? 0) || 0;
  const list = useAudit({ action: action || undefined, from: from ? wibDayStartUtc(from) : undefined, to: to ? wibDayEndExclusiveUtc(to) : undefined, offset });

  if (!can("audit:read")) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Riwayat audit</h1><p className="text-sm text-muted-foreground">Hanya baca. Dicatat oleh server, bukan oleh halaman ini.</p></div>
      <div className="flex flex-wrap items-end gap-3">
        <SearchBox value={action} onChange={(v) => set({ action: v, offset: 0 })} placeholder="Filter aksi, mis. invoice.confirm_payment" label="Filter aksi" />
        <label className="text-xs text-muted-foreground">Dari (tanggal WIB)<Input type="date" value={from} onChange={(e) => set({ from: e.target.value, offset: 0 })} className="mt-1 w-40" /></label>
        <label className="text-xs text-muted-foreground">Sampai (tanggal WIB, termasuk)<Input type="date" value={to} onChange={(e) => set({ to: e.target.value, offset: 0 })} className="mt-1 w-40" /></label>
      </div>
      {list.isLoading ? <LoadingBlock /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data || list.data.items.length === 0 ? (
        <EmptyState title="Belum ada catatan" text="Tidak ada catatan audit yang cocok dengan filter ini." />
      ) : (
        <>
          {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Operator</TableHead><TableHead>Aksi</TableHead><TableHead>Target</TableHead><TableHead>Alamat IP</TableHead><TableHead>Alasan</TableHead><TableHead>Perubahan</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.data.items.map((a) => {
                  const link = a.target ? targetLink(a.target) : null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(a.at)}</TableCell>
                      <TableCell>{a.operator?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action}</TableCell>
                      <TableCell>{a.target ? (link ? <Link href={link} className="text-primary underline underline-offset-2">{a.target.label ?? a.target.id}</Link> : (a.target.label ?? a.target.id)) : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{can("owner:insights") ? (a.client_ip ?? "—") : "—"}</TableCell>
                      <TableCell className="max-w-56 text-sm">{a.reason ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {Object.keys(a.changes).length === 0 ? "—" : <ul className="space-y-0.5">{Object.entries(a.changes).map(([k, v]) => <li key={k}><span className="font-medium">{k}</span>: {clip(v.from)} → {clip(v.to)}</li>)}</ul>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pager pagination={list.data.pagination} onOffset={(o) => set({ offset: o })} busy={list.isFetching} />
        </>
      )}
    </div>
  );
}

export default function AuditPage() { return <Suspense><AuditList /></Suspense>; }
