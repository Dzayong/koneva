"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { Card, FieldList } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { StudentStatusBadge } from "@/components/operator/status-badges";
import { StudentDecisionDialog } from "@/components/operator/student-decision-dialog";
import { Button } from "@/components/ui/button";
import { useOperatorSession, useStudentRequest } from "@/hooks/use-operator";
import { formatDate } from "@/lib/utils";

export default function StudentRequestPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { can } = useOperatorSession();
  const request = useStudentRequest(id);
  const [open, setOpen] = useState(false);

  if (!can("students:read")) return <ForbiddenState />;
  if (request.isLoading) return <LoadingBlock />;
  if (request.error || !request.data) return <ErrorState error={request.error} onRetry={() => void request.refetch()} />;
  const r = request.data;

  return (
    <div className="space-y-6">
      <Link href="/operator/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Kembali ke pengajuan</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{r.workspace.name}</h1><StudentStatusBadge status={r.status} /></div>
        {r.status === "pending" && can("students:decide") && (
          <div className="flex items-center gap-3">
            {request.isFetching && <span role="status" className="text-xs text-muted-foreground">Memeriksa status terbaru…</span>}
            <Button disabled={request.isFetching} onClick={() => setOpen(true)}>Putuskan</Button>
          </div>
        )}
      </div>

      <p role="note" className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Domain email hanya menunjukkan asal email, bukan bukti status pelajar. Pertimbangkan email, catatan pengaju, dan konteks lain sebelum memutuskan.</p>

      <Card title="Pengajuan">
        <FieldList items={[
          ["Email pengaju", r.requester_email || r.requester_email_masked], ["Domain", `${r.email_domain}${r.academic_domain_hint ? " (pola domain akademik)" : " (bukan pola domain akademik)"}`],
          ["Diajukan", formatDate(r.requested_at)], ["Catatan pengaju", r.note],
          ["Diputuskan", r.decided_at ? `${formatDate(r.decided_at)}${r.decided_by ? ` oleh ${r.decided_by.name}` : ""}` : null], ["Alasan keputusan", r.reason],
        ]} />
      </Card>

      {r.workspace.id && can("workspaces:read") && <p className="text-sm"><Link href={`/operator/workspaces/${r.workspace.id}`} className="text-primary underline underline-offset-2">Lihat detail workspace</Link></p>}

      {r.history.length > 0 && (
        <Card title="Riwayat pengajuan lain untuk workspace ini">
          <ul className="space-y-1 text-sm">{r.history.map((h) => <li key={h.id} className="flex items-center gap-3"><StudentStatusBadge status={h.status} /><span className="text-muted-foreground">{h.decided_at ? formatDate(h.decided_at) : "—"}{h.decided_by ? ` · ${h.decided_by.name}` : ""}</span></li>)}</ul>
        </Card>
      )}

      {(r.status === "pending" || open) && can("students:decide") && (
        <StudentDecisionDialog request={r} open={open} onOpenChange={setOpen} onRefresh={() => request.refetch()} />
      )}
    </div>
  );
}
