"use client";

import { useState } from "react";
import { ChevronDown, Download, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rupiah } from "@/components/billing/plan-cards";
import { useUsageHistory, useUsageDevices, useUsageDeviceSummary } from "@/hooks/use-billing";
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

const STATUS_LABEL: Record<string, string> = {
  queued: "Antrean",
  sending: "Mengirim",
  sent: "Terkirim",
  delivered: "Diterima",
  read: "Dibaca",
  failed: "Gagal",
  blocked: "Diblokir",
};

const ERROR_LABEL: Record<string, string> = {
  delivery_uncertain: "Pesan dikirim ke server WhatsApp tapi tidak mendapat konfirmasi. Koneksi WA mungkin terputus saat pengiriman.",
  rate_limit_per_minute: "Ditahan oleh rate limiter (terlalu banyak pesan dalam 1 menit).",
  not_connected: "Device tidak terhubung ke WhatsApp saat pesan diproses.",
  queue_expired: "Pesan kedaluwarsa di antrean sebelum sempat dikirim.",
  recipient_opted_out: "Penerima sudah minta berhenti menerima pesan.",
  recipient_consent_required: "Penerima belum memberikan izin menerima pesan.",
  outside_working_hours: "Ditahan karena di luar jam kerja yang diatur.",
};

export default function UsageHistoryPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const [filters, setFilters] = useState<UsageHistoryFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: devices } = useUsageDevices();
  const { data, isLoading } = useUsageHistory(filters);
  const { data: deviceSummary, isLoading: summaryLoading } = useUsageDeviceSummary({
    date_from: filters.date_from,
    date_to: filters.date_to,
  });

  if (!permsLoading && !can("billing:manage")) {
    return <p className="text-muted-foreground">Hanya pemilik workspace yang bisa membuka halaman ini.</p>;
  }

  const setFilter = (patch: Partial<UsageHistoryFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch, offset: 0 }));

  const resetFilters = () => setFilters({ limit: PAGE_SIZE, offset: 0 });

  const page = Math.floor((filters.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE)) : 1;

  const handleCsvDownload = () => {
    const csvFilters = { ...filters, limit: undefined, offset: undefined };
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

      {/* Per-device breakdown */}
      {summaryLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : deviceSummary && deviceSummary.length > 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="border-b px-5 py-3">
            <h3 className="text-sm font-semibold">Penggunaan per device</h3>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead className="text-right">Pesan</TableHead>
                  <TableHead className="text-right">Berhasil</TableHead>
                  <TableHead className="text-right">API</TableHead>
                  <TableHead className="text-right">Otomatis</TableHead>
                  <TableHead className="text-right">AI</TableHead>
                  <TableHead className="text-right">Biaya</TableHead>
                  <TableHead className="text-right">Refund</TableHead>
                  <TableHead>Aktivitas terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deviceSummary.map((d) => (
                  <TableRow key={d.device_key} className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setFilter({ device_key: d.device_key })}>
                    <TableCell>
                      <span className="font-mono text-xs">{d.device_key}</span>
                      {d.label && <span className="ml-2 text-xs text-muted-foreground">{d.label}</span>}
                    </TableCell>
                    <TableCell className="text-right">{d.total_messages.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right">{d.total_successful.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right text-xs">{d.api_count.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right text-xs">{d.auto_reply_count.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right text-xs">{d.ai_reply_count.toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-right font-medium">{rupiah(d.total_spend_idr)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{rupiah(d.total_refunded_idr)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.last_activity ? formatDate(d.last_activity) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y md:hidden">
            {deviceSummary.map((d) => (
              <div key={d.device_key} className="space-y-1 px-4 py-3" onClick={() => setFilter({ device_key: d.device_key })}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{d.label || d.device_key}</span>
                  <span className="text-sm font-semibold">{rupiah(d.total_spend_idr)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <span>{d.total_messages} pesan</span>
                  <span>·</span>
                  <span>API {d.api_count}</span>
                  <span>·</span>
                  <span>Otomatis {d.auto_reply_count}</span>
                  <span>·</span>
                  <span>AI {d.ai_reply_count}</span>
                </div>
              </div>
            ))}
          </div>
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
                    const expanded = expandedId === row.message_id;
                    return (
                      <>
                      <TableRow key={row.message_id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.message_id)}>
                        <TableCell className="whitespace-nowrap text-xs">
                          <ChevronDown className={`mr-1 inline h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                          {formatDate(row.created_at)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.device_key}</TableCell>
                        <TableCell className="font-mono text-xs">{row.to_number}</TableCell>
                        <TableCell><Badge variant="outline">{CATEGORY_LABEL[row.billing_category] ?? row.billing_category}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{STATUS_LABEL[row.message_status] ?? row.message_status}</Badge></TableCell>
                        <TableCell className="text-right text-xs">{rupiah(row.unit_price_idr)}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{rupiah(row.charged_idr)}</TableCell>
                        <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.message_id}-detail`}>
                          <TableCell colSpan={8} className="bg-muted/30 px-6 py-4">
                            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <p className="font-medium text-muted-foreground">Isi pesan</p>
                                <p className="mt-0.5">{row.content_preview || "—"}</p>
                              </div>
                              <div>
                                <p className="font-medium text-muted-foreground">Status pengiriman</p>
                                <p className="mt-0.5">{STATUS_LABEL[row.message_status] ?? row.message_status}</p>
                              </div>
                              {row.error_message && (
                                <div className="sm:col-span-2">
                                  <p className="font-medium text-destructive">Alasan gagal</p>
                                  <p className="mt-0.5">{ERROR_LABEL[row.error_message] ?? row.error_message}</p>
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-muted-foreground">Masuk antrean</p>
                                <p className="mt-0.5 tabular-nums">{formatDate(row.created_at)}</p>
                              </div>
                              <div>
                                <p className="font-medium text-muted-foreground">Mulai kirim</p>
                                <p className="mt-0.5 tabular-nums">{row.send_started_at ? formatDate(row.send_started_at) : "—"}</p>
                              </div>
                              <div>
                                <p className="font-medium text-muted-foreground">Terkirim</p>
                                <p className="mt-0.5 tabular-nums">{row.sent_at ? formatDate(row.sent_at) : "—"}</p>
                              </div>
                              <div>
                                <p className="font-medium text-muted-foreground">Diterima / Dibaca</p>
                                <p className="mt-0.5 tabular-nums">
                                  {row.delivered_at ? formatDate(row.delivered_at) : "—"}
                                  {row.read_at ? ` · Dibaca ${formatDate(row.read_at)}` : ""}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y md:hidden">
              {data.data.map((row) => {
                const badge = RESERVATION_BADGE[row.reservation_state] ?? { label: row.reservation_state, variant: "outline" as const };
                const expanded = expandedId === row.message_id;
                return (
                  <div key={row.message_id} className="cursor-pointer px-4 py-3" onClick={() => setExpandedId(expanded ? null : row.message_id)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        <ChevronDown className={`mr-1 inline h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        {formatDate(row.created_at)}
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{row.to_number}</span>
                      <span className="text-sm font-semibold">{rupiah(row.charged_idr)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{row.device_key}</Badge>
                      <Badge variant="outline">{CATEGORY_LABEL[row.billing_category] ?? row.billing_category}</Badge>
                      <Badge variant="outline">{STATUS_LABEL[row.message_status] ?? row.message_status}</Badge>
                    </div>
                    {expanded && (
                      <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
                        {row.content_preview && <div><span className="font-medium text-muted-foreground">Pesan:</span> {row.content_preview}</div>}
                        {row.error_message && <div className="text-destructive"><span className="font-medium">Gagal:</span> {ERROR_LABEL[row.error_message] ?? row.error_message}</div>}
                        <div className="grid grid-cols-2 gap-2">
                          <div><span className="font-medium text-muted-foreground">Antrean:</span> {formatDate(row.created_at)}</div>
                          <div><span className="font-medium text-muted-foreground">Mulai kirim:</span> {row.send_started_at ? formatDate(row.send_started_at) : "—"}</div>
                          <div><span className="font-medium text-muted-foreground">Terkirim:</span> {row.sent_at ? formatDate(row.sent_at) : "—"}</div>
                          <div><span className="font-medium text-muted-foreground">Diterima:</span> {row.delivered_at ? formatDate(row.delivered_at) : "—"}</div>
                        </div>
                      </div>
                    )}
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
