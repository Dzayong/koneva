"use client";

import Link from "next/link";
import { AlertTriangle, CreditCard, GraduationCap } from "lucide-react";
import { Card } from "@/components/operator/field-list";
import { ErrorState } from "@/components/operator/page-state";
import { useInvoices, useOperatorSession, useOtpAlerts, useStudentRequests } from "@/hooks/use-operator";

function Count({ label, total, href, icon: Icon, loading, error, onRetry }: { label: string; total: number | undefined; href: string; icon: typeof CreditCard; loading: boolean; error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          {error ? <div className="mt-2"><ErrorState error={error} onRetry={onRetry} /></div> : <p className="mt-1 text-4xl font-semibold tabular-nums" aria-live="polite">{loading ? "…" : total ?? 0}</p>}
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <Link href={href} className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-2">Buka antrean</Link>
    </Card>
  );
}

export default function OperatorHomePage() {
  const { can } = useOperatorSession();
  const invoices = useInvoices({ status: "unpaid" });
  const students = useStudentRequests({ status: "pending" });
  const alerts = useOtpAlerts(can("audit:read"));
  return (
    <div className="space-y-6">
      {alerts.data?.has_active && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><strong>Peringatan kuota email OTP.</strong> Sebuah ambang tercapai dalam 24 jam terakhir. <Link href="/operator/alerts" className="font-medium underline underline-offset-2">Lihat detail</Link></span>
        </div>
      )}
      <div><h1 className="text-2xl font-semibold tracking-tight">Ringkasan antrean</h1><p className="text-sm text-muted-foreground">Pekerjaan yang menunggu tindakan operator.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {can("payments:read") && <Count label="Invoice belum dibayar" total={invoices.data?.pagination.total} href="/operator/payments" icon={CreditCard} loading={invoices.isLoading} error={invoices.error} onRetry={() => void invoices.refetch()} />}
        {can("students:read") && <Count label="Pengajuan pelajar menunggu" total={students.data?.pagination.total} href="/operator/students" icon={GraduationCap} loading={students.isLoading} error={students.error} onRetry={() => void students.refetch()} />}
      </div>
    </div>
  );
}
