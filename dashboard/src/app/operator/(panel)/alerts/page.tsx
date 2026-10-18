"use client";

import { Suspense } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Info } from "lucide-react";
import { Card } from "@/components/operator/field-list";
import { EmptyState, ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOperatorSession, useOtpAlerts } from "@/hooks/use-operator";
import type { OtpAlertEvent } from "@/lib/operator/types";
import { formatDate } from "@/lib/utils";

const SCOPE = (e: Pick<OtpAlertEvent, "window_hours">) => `Pengirim email OTP, seluruh sistem, ${e.window_hours} jam bergulir`;
const KIND: Record<OtpAlertEvent["kind"], string> = { sender_70_percent: "Ambang 70% tercapai", sender_cap_reached: "Batas maksimum tercapai (permintaan ditolak)" };

function Alerts() {
  const { can } = useOperatorSession();
  const alerts = useOtpAlerts(can("audit:read"));
  if (!can("audit:read")) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Peringatan OTP</h1>
        <p className="text-sm text-muted-foreground">Pemakaian kuota pengiriman email OTP. Hanya baca.</p>
      </div>
      <p role="note" className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Peringatan ini <strong>hanya terlihat di halaman ini</strong>: tidak ada email, WhatsApp, atau notifikasi lain. Operator perlu membuka panel untuk melihatnya. Angka di tabel adalah <strong>snapshot saat kejadian</strong>, bukan pemakaian terkini. Tiap jenis kejadian dicatat sekali per 24 jam, jadi pengiriman berikutnya tidak menghasilkan peringatan berulang. Tidak ada alamat email, IP, kode, atau kunci pembatas di sini.</span>
      </p>
      {alerts.isLoading ? <LoadingBlock /> : alerts.error && !alerts.data ? <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} /> : alerts.data && (
        <>
          {alerts.data.has_active ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span><strong>Ada peringatan aktif.</strong> Sebuah ambang tercapai dalam 24 jam terakhir. Periksa kuota pengirim sebelum pengiriman OTP tertahan.</span>
            </div>
          ) : (
            <p role="status" className="flex items-center gap-2 rounded-lg border p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />Tidak ada peringatan aktif.</p>
          )}
          <Card title="Pemakaian terkini">
            <p className="text-3xl font-semibold tabular-nums">{alerts.data.current.usage} <span className="text-base font-normal text-muted-foreground">dari {alerts.data.current.cap} ({alerts.data.current.percent}%)</span></p>
            <p className="mt-1 text-xs text-muted-foreground">Email OTP terkirim dalam {alerts.data.current.window_hours} jam bergulir terakhir, dibanding batas yang berlaku sekarang. Diukur {formatDate(alerts.data.current.measured_at)}.</p>
          </Card>
          {alerts.data.events.length === 0 ? (
            <EmptyState title="Tidak ada peringatan" text={`Tidak ada ambang yang tercapai dalam ${alerts.data.history_days} hari terakhir.`} />
          ) : (
            <div className="space-y-3 md:hidden">
              {alerts.data.events.map((e) => (
                <article key={e.id} className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><div><p className="font-medium">{KIND[e.kind]}</p><p className="mt-1 text-xs text-muted-foreground">{e.severity === "critical" ? "Kritis" : "Peringatan"}</p></div></div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(e.at)}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="col-span-2"><dt className="text-xs text-muted-foreground">Cakupan batas</dt><dd className="mt-1">{SCOPE(e)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Pemakaian saat kejadian</dt><dd className="mt-1 tabular-nums">{e.usage_at_event} ({e.percent_at_event}%)</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Batas saat kejadian</dt><dd className="mt-1 tabular-nums">{e.cap_at_event}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1">{e.active ? <strong>Aktif (dalam 24 jam)</strong> : "Riwayat"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
          {alerts.data.events.length > 0 && <div className="hidden overflow-x-auto rounded-xl border md:block">
              <Table>
                <caption className="sr-only">Kejadian ambang OTP {alerts.data.history_days} hari terakhir</caption>
                <TableHeader><TableRow><TableHead>Waktu kejadian</TableHead><TableHead>Kejadian</TableHead><TableHead>Cakupan batas</TableHead><TableHead>Pemakaian saat kejadian (snapshot)</TableHead><TableHead>Batas saat kejadian</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {alerts.data.events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(e.at)}</TableCell>
                      <TableCell><span className="inline-flex items-center gap-1.5 font-medium"><BellRing className="h-3.5 w-3.5" aria-hidden />{KIND[e.kind]}</span><span className="block text-xs text-muted-foreground">{e.severity === "critical" ? "Kritis" : "Peringatan"}</span></TableCell>
                      <TableCell className="text-sm">{SCOPE(e)}</TableCell>
                      <TableCell className="tabular-nums">{e.usage_at_event} ({e.percent_at_event}%)</TableCell>
                      <TableCell className="tabular-nums">{e.cap_at_event}</TableCell>
                      <TableCell className="text-sm">{e.active ? <strong>Aktif (dalam 24 jam)</strong> : "Riwayat"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </div>}
        </>
      )}
    </div>
  );
}

export default function OtpAlertsPage() { return <Suspense><Alerts /></Suspense>; }
