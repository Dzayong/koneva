"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { rupiah } from "@/components/billing/plan-cards";
import { ConfirmPaymentDialog } from "@/components/operator/confirm-payment-dialog";
import { Card, FieldList } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { InvoiceStatusBadge, StudentStatusBadge } from "@/components/operator/status-badges";
import { Button } from "@/components/ui/button";
import { useInvoice, useOperatorSession } from "@/hooks/use-operator";
import type { StudentStatus } from "@/lib/operator/types";
import { formatDate } from "@/lib/utils";

export default function InvoiceDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { can } = useOperatorSession();
  const invoice = useInvoice(id);
  const [open, setOpen] = useState(false);

  if (!can("payments:read")) return <ForbiddenState />;
  if (invoice.isLoading) return <LoadingBlock />;
  if (invoice.error || !invoice.data) return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;
  const i = invoice.data;

  return (
    <div className="space-y-6">
      <Link href="/operator/payments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Kembali ke pembayaran</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h1 className="font-mono text-2xl font-semibold">{i.number}</h1><InvoiceStatusBadge status={i.status} /></div>
        {i.status === "unpaid" && can("payments:confirm") && (
          // Acting is allowed only on a status that was just read: a cached copy (e.g. after a reload or a lost dialog) is refreshed first.
          <div className="flex items-center gap-3">
            {invoice.isFetching && <span role="status" className="text-xs text-muted-foreground">Memeriksa status terbaru…</span>}
            <Button disabled={invoice.isFetching} onClick={() => setOpen(true)}>Konfirmasi pembayaran</Button>
          </div>
        )}
      </div>

      <Card title="Invoice">
        <FieldList items={[
          ["Jumlah", <strong key="a">{rupiah(i.amount_idr)}</strong>], ["Paket", `${i.plan.name} (${i.cycle === "yearly" ? "tahunan" : "bulanan"})`],
          ["Dibuat", formatDate(i.created_at)], ["Jatuh tempo", formatDate(i.due_at)],
          ["Dibayar", i.paid_at ? formatDate(i.paid_at) : null], ["Metode", i.method], ["Referensi", i.reference],
          ["Dikonfirmasi oleh", i.confirmed_by?.name ?? null], ["Catatan", i.note],
        ]} />
      </Card>

      <Card title="Workspace">
        <FieldList items={[
          ["Nama", can("workspaces:read") ? <Link key="w" href={`/operator/workspaces/${i.workspace.id}`} className="text-primary underline underline-offset-2">{i.workspace.name}</Link> : i.workspace.name],
          ["Pemilik", i.workspace_owner ? `${i.workspace_owner.name} (${i.workspace_owner.email})` : null],
          ["Langganan sekarang", i.subscription ? `${i.subscription.plan} · ${i.subscription.status}${i.subscription.period_end ? ` · sampai ${formatDate(i.subscription.period_end)}` : ""}` : null],
          ["Status pelajar", i.student ? <StudentStatusBadge key="s" status={(i.student.status as StudentStatus)} /> : "Tidak disyaratkan"],
        ]} />
      </Card>

      {i.timeline.length > 0 && (
        <Card title="Riwayat">
          <ol className="space-y-1 text-sm">{i.timeline.map((t, n) => <li key={n} className="flex gap-3"><span className="w-44 shrink-0 text-muted-foreground">{formatDate(t.at)}</span><span>{t.event}</span></li>)}</ol>
        </Card>
      )}

      {/* Stays mounted while open even after the invoice turns Paid, so the operator sees the server's confirmation. */}
      {(i.status === "unpaid" || open) && can("payments:confirm") && (
        <ConfirmPaymentDialog invoice={i} open={open} onOpenChange={setOpen} onRefresh={async () => (await invoice.refetch()).data} />
      )}
    </div>
  );
}
