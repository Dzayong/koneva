"use client";

import { Suspense } from "react";
import Link from "next/link";
import { rupiah } from "@/components/billing/plan-cards";
import { EmptyState, ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Pager } from "@/components/operator/pager";
import { SearchBox } from "@/components/operator/search-box";
import { InvoiceStatusBadge } from "@/components/operator/status-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInvoices, useOperatorSession } from "@/hooks/use-operator";
import { useSearchParamsState } from "@/hooks/use-search-params-state";
import type { InvoiceStatus } from "@/lib/operator/types";
import { formatDate } from "@/lib/utils";

type Filter = InvoiceStatus | "all";
const STATUSES: Array<[Filter, string]> = [["unpaid", "Belum dibayar"], ["paid", "Lunas"], ["void", "Dibatalkan"], ["all", "Semua"]];

function PaymentsList() {
  const { can } = useOperatorSession();
  const { params, set } = useSearchParamsState();
  const raw = params.get("status");
  const status: Filter = raw === "paid" || raw === "void" || raw === "all" ? raw : "unpaid";
  const q = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0) || 0;
  const list = useInvoices({ status: status === "all" ? undefined : status, q: q || undefined, offset });

  if (!can("payments:read")) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Pembayaran</h1><p className="text-sm text-muted-foreground">Konfirmasi pembayaran manual. Buka invoice untuk memeriksa lalu mengonfirmasi.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter status" className="inline-flex max-w-full flex-wrap rounded-lg border bg-muted p-1">
          {STATUSES.map(([value, label]) => (
            <button key={label} type="button" aria-pressed={status === value} onClick={() => set({ status: value === "unpaid" ? undefined : value, offset: 0 })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
        <SearchBox value={q} onChange={(v) => set({ q: v, offset: 0 })} placeholder="Cari nomor invoice atau workspace" label="Cari invoice" />
      </div>
      {list.isLoading ? <LoadingBlock /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data || list.data.items.length === 0 ? (
        <EmptyState title="Tidak ada invoice" text="Tidak ada invoice yang cocok dengan filter ini." />
      ) : (
        <>
          {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
          <div className="space-y-3 md:hidden">
            {list.data.items.map((i) => (
              <article key={i.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/operator/payments/${i.id}`} className="break-all font-mono text-sm text-primary underline underline-offset-2">{i.number}</Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{i.workspace.name}</p>
                  </div>
                  <InvoiceStatusBadge status={i.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Paket</dt><dd className="mt-1">{i.plan.name} · {i.cycle === "yearly" ? "tahunan" : "bulanan"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Jumlah</dt><dd className="mt-1 font-medium tabular-nums">{rupiah(i.amount_idr)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Dibuat</dt><dd className="mt-1">{formatDate(i.created_at)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Jatuh tempo</dt><dd className="mt-1">{formatDate(i.due_at)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Workspace</TableHead><TableHead>Paket</TableHead><TableHead className="text-right">Jumlah</TableHead><TableHead>Status</TableHead><TableHead>Dibuat</TableHead><TableHead>Jatuh tempo</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.data.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><Link href={`/operator/payments/${i.id}`} className="font-mono text-primary underline underline-offset-2">{i.number}</Link></TableCell>
                    <TableCell>{i.workspace.name}</TableCell>
                    <TableCell>{i.plan.name} · {i.cycle === "yearly" ? "tahunan" : "bulanan"}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(i.amount_idr)}</TableCell>
                    <TableCell><InvoiceStatusBadge status={i.status} /></TableCell>
                    <TableCell>{formatDate(i.created_at)}</TableCell>
                    <TableCell>{formatDate(i.due_at)}</TableCell>
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

export default function PaymentsPage() { return <Suspense><PaymentsList /></Suspense>; }
