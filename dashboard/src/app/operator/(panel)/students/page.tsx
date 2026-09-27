"use client";

import { Suspense } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Pager } from "@/components/operator/pager";
import { SearchBox } from "@/components/operator/search-box";
import { StudentStatusBadge } from "@/components/operator/status-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOperatorSession, useStudentRequests } from "@/hooks/use-operator";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import type { StudentStatus } from "@/lib/operator/types";
import { formatDate } from "@/lib/utils";

type Filter = StudentStatus | "all";
const STATUSES: Array<[Filter, string]> = [["pending", "Menunggu"], ["approved", "Disetujui"], ["rejected", "Ditolak"], ["all", "Semua"]];

function StudentsList() {
  const { can } = useOperatorSession();
  const { params, set } = useSearchParamsState();
  const raw = params.get("status");
  const status: Filter = raw === "approved" || raw === "rejected" || raw === "all" ? raw : "pending";
  const q = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0) || 0;
  const list = useStudentRequests({ status: status === "all" ? undefined : status, q: q || undefined, offset });

  if (!can("students:read")) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Pengajuan pelajar</h1><p className="text-sm text-muted-foreground">Periksa pengajuan lalu setujui atau tolak. Email dan domain hanya petunjuk, bukan bukti status pelajar.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter status" className="inline-flex rounded-lg border bg-muted p-1">
          {STATUSES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => set({ status: value === "pending" ? undefined : value, offset: 0 })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
        <SearchBox value={q} onChange={(v) => set({ q: v, offset: 0 })} placeholder="Cari workspace atau domain" label="Cari pengajuan" />
      </div>
      {list.isLoading ? <LoadingBlock /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data || list.data.items.length === 0 ? (
        <EmptyState title="Tidak ada pengajuan" text="Tidak ada pengajuan yang cocok dengan filter ini." />
      ) : (
        <>
          {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Email (disamarkan)</TableHead><TableHead>Domain</TableHead><TableHead>Status</TableHead><TableHead>Diajukan</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link href={`/operator/students/${r.id}`} className="text-primary underline underline-offset-2">{r.workspace.name}</Link></TableCell>
                    <TableCell className="font-mono text-xs">{r.requester_email_masked}</TableCell>
                    <TableCell>{r.email_domain}</TableCell>
                    <TableCell><StudentStatusBadge status={r.status} /></TableCell>
                    <TableCell>{formatDate(r.requested_at)}</TableCell>
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

export default function StudentsPage() { return <Suspense><StudentsList /></Suspense>; }
