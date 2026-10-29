"use client";

import { useState } from "react";
import { Download, Filter, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rupiah } from "@/components/billing/plan-cards";
import { useUsageHistory, useUsageDevices } from "@/hooks/use-billing";
import { usePermissions } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { UsageHistoryFilters, PaygBillingCategory } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 25;

const CATEGORY_LABEL: Record<PaygBillingCategory, string> = {
  api: "API",
  auto_reply: "Otomatis",
  ai_reply: "AI",
};

const STATUS_FILTER_LABEL: Record<string, string> = {
  charged: "Tertagih",
  refunded: "Dikembalikan",
  pending: "Menunggu",
};

const RESERVATION_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  captured: { label: "Tertagih", variant: "default" },
  released: { label: "Dikembalikan", variant: "secondary" },
  debited: { label: "Menunggu", variant: "outline" },
};

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

export default function UsageHistoryPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const [filters, setFilters] = useState<UsageHistoryFilters>({ limit: PAGE_SIZE, offset: 0 });
  const { data: devices } = useUsageDevices();
  const { data, isLoading } = useUsageHistory(filters);

  if (!permsLoading && !can("billing:manage")) {
    return <p className="text-muted-foreground">Hanya pemilik workspace yang bisa membuka halaman ini.</p>;
  }

  const setFilter = (patch: Partial<UsageHistoryFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch, offset: 0 }));

  const resetFilters = () => setFilters({ limit: PAGE_SIZE, offset: 0 });

  const page = Math.floor((filters.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE)) : 1;

  const handleCsvDownload = () => {
    const { limit: _, offset: __, ...csvFilters } = filters;
    const url = api.getUsageCsvUrl(csvFilters);
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Riwayat Penggunaan</h1>
          <p className="text-sm text-muted-foreground">Detail biaya per pesan terkirim.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCsvDownload} disabled={!data || data.pagination.total === 0}>
          <Download className="mr-2 h-4 w-4" />Unduh CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Device</label>
          <Select value={filters.device_key ?? "__all__"} onValueChange={(v) => setFilter({ device_key: v === "__all__" ? undefined : v })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua device</SelectItem>
              {devices?.map((dk) => <SelectItem key={dk} value={dk}>{dk}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Kategori</label>
          <Select value={filters.billing_category ?? "__all__"} onValueChange={(v) => setFilter({ billing_category: v === "__all__" ? undefined : v as PaygBillingCategory })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua</SelectItem>
              {(Object.entries(CATEGORY_LABEL) as [PaygBillingCategory, string][]).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status biaya</label>
          <Select value={filters.status ?? "__all__"} onValueChange={(v) => setFilter({ status: v === "__all__" ? undefined : v as UsageHistoryFilters["status"] })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua</SelectItem>
              {Object.entries(STATUS_FILTER_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Dari</label>
          <input type="date" value={filters.date_from ?? ""} onChange={(e) => setFilter({ date_from: e.target.value || undefined })}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Sampai</label>
          <input type="date" value={filters.date_to ?? ""} onChange={(e) => setFilter({ date_to: e.target.value || undefined })}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </div>
        <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reset</Button>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total percobaan" value={data.summary.total_attempts.toLocaleString("id-ID")} />
          <SummaryCard label="Berhasil dikirim" value={data.summary.total_successful.toLocaleString("id-ID")} />
          <SummaryCard label="Gagal / dikembalikan" value={data.summary.total_failed_refunded.toLocaleString("id-ID")} />
          <SummaryCard label="Total biaya" value={rupiah(data.summary.total_spend_idr)} />
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-xl border bg-card">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {data ? "Belum ada riwayat penggunaan dengan filter ini." : "Gagal memuat data."}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Penerima</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Tarif</TableHead>
                    <TableHead className="text-right">Biaya</TableHead>
                    <TableHead>Biaya</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((row) => {
                    const badge = RESERVATION_BADGE[row.reservation_state] ?? { label: row.reservation_state, variant: "outline" as const };
                    return (
                      <TableRow key={row.message_id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDate(row.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.device_key}</TableCell>
                        <TableCell className="font-mono text-xs">{row.to_number}</TableCell>
                        <TableCell><Badge variant="outline">{CATEGORY_LABEL[row.billing_category] ?? row.billing_category}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{row.message_status}</Badge></TableCell>
                        <TableCell className="text-right text-xs">{rupiah(row.unit_price_idr)}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{rupiah(row.charged_idr)}</TableCell>
                        <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y md:hidden">
              {data.data.map((row) => {
                const badge = RESERVATION_BADGE[row.reservation_state] ?? { label: row.reservation_state, variant: "outline" as const };
                return (
                  <div key={row.message_id} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{row.to_number}</span>
                      <span className="text-sm font-semibold">{rupiah(row.charged_idr)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">{row.device_key}</Badge>
                      <Badge variant="outline">{CATEGORY_LABEL[row.billing_category] ?? row.billing_category}</Badge>
                      <Badge variant="outline">{row.message_status}</Badge>
                    </div>
                    {row.content_preview && <p className="truncate text-xs text-muted-foreground">{row.content_preview}</p>}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {data.pagination.total.toLocaleString("id-ID")} data · Halaman {page} dari {totalPages}
              </p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={page <= 1}
                  onClick={() => setFilters((prev) => ({ ...prev, offset: Math.max(0, (prev.offset ?? 0) - PAGE_SIZE) }))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={!data.pagination.has_more}
                  onClick={() => setFilters((prev) => ({ ...prev, offset: (prev.offset ?? 0) + PAGE_SIZE }))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
