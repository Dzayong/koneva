"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { ReauthPrompt } from "@/components/operator/reauth-prompt";
import { studentStatusLabel } from "@/components/operator/status-badges";
import { OperatorApiError } from "@/lib/operator/errors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDecideStudent } from "@/hooks/use-operator";
import { useGuardedSubmit } from "@/hooks/use-guarded-submit";
import { operatorErrorText } from "@/lib/operator/errors";
import type { DecisionInput, DecisionResult, StudentRequestDetail } from "@/lib/operator/types";
import { formatDate } from "@/lib/utils";

/** Approve or reject a PENDING request. Revoke is intentionally not offered (its effect on active plans is undecided). */
export function StudentDecisionDialog({ request, open, onOpenChange, onRefresh }: {
  request: StudentRequestDetail; open: boolean; onOpenChange: (open: boolean) => void; onRefresh: () => Promise<unknown>;
}) {
  const { phase, run, backToEdit, reset } = useGuardedSubmit<DecisionResult>();
  const decide = useDecideStudent(request.id);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const reasonOk = decision === "approve" || reason.trim().length >= 5;
  const input: DecisionInput = { decision, ...(reason.trim() ? { reason: reason.trim() } : {}), expected: { request_id: request.id, version: request.version } };
  const busy = phase.kind === "submitting";
  const locked = busy || phase.kind === "unknown" || phase.kind === "done";

  const send = () => void run({ request_id: request.id, ...input }, (key) => decide.mutateAsync({ input, key }));
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o || !busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => { if (locked) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Putuskan pengajuan pelajar</DialogTitle>
          <DialogDescription>{request.workspace.name}. Keputusan tercatat di audit dan tidak bisa dibatalkan dari panel ini.</DialogDescription>
        </DialogHeader>

        {phase.kind === "done" ? (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />Keputusan tercatat: {studentStatusLabel(phase.result.status)}{phase.result.decided_at ? ` (${formatDate(phase.result.decided_at)})` : ""}</p>
        ) : (
          <>
            {phase.kind === "conflict" && (
              <div role="alert" className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4" aria-hidden />{operatorErrorText(phase.error)}</p>
                {typeof phase.error.details["current_status"] === "string" && <p>Status sekarang: <strong>{phase.error.details["current_status"]}</strong>{typeof (phase.error.details["decided_by"] as { name?: string } | undefined)?.name === "string" ? <> oleh {(phase.error.details["decided_by"] as { name: string }).name}</> : null}.</p>}
              </div>
            )}
            {phase.kind === "failed" && phase.error instanceof OperatorApiError && phase.error.kind === "reauth_required" && <ReauthPrompt onSignedIn={send} />}
            {phase.kind === "failed" && !(phase.error instanceof OperatorApiError && phase.error.kind === "reauth_required") && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{operatorErrorText(phase.error)}</p>}
            {phase.kind === "unknown" && (
              <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4" aria-hidden />Hasil belum pasti</p>
                <p className="mt-1">Keputusan mungkin sudah tersimpan. Mencoba lagi memakai kunci yang sama aman dan tidak memutuskan dua kali.</p>
              </div>
            )}
            <fieldset className="space-y-2" disabled={locked}>
              <legend className="text-sm font-medium">Keputusan</legend>
              {(["approve", "reject"] as const).map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm"><input type="radio" name="decision" checked={decision === d} onChange={() => setDecision(d)} className="accent-[var(--primary)]" />{d === "approve" ? "Setujui sebagai pelajar" : "Tolak"}</label>
              ))}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="sd-reason">Alasan {decision === "reject" ? "(wajib)" : "(opsional)"}</Label>
              <Textarea id="sd-reason" value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} disabled={locked} aria-invalid={!reasonOk} />
              {!reasonOk && <p className="text-xs text-destructive">Tulis alasan penolakan (minimal 5 karakter).</p>}
            </div>
            <DialogFooter className="gap-2">
              {phase.kind === "unknown" ? (
                <>
                  <Button variant="outline" disabled={refreshing} onClick={() => void refresh()}>{refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Periksa status</Button>
                  <Button onClick={send}>Coba lagi (aman diulang)</Button>
                </>
              ) : phase.kind === "conflict" ? (
                <Button disabled={refreshing} onClick={() => void refresh().then(() => { reset(); onOpenChange(false); })}>{refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Muat ulang data</Button>
              ) : (
                <>
                  <Button variant="ghost" disabled={busy} onClick={() => { backToEdit(); onOpenChange(false); }}>Batal</Button>
                  <Button disabled={busy || !reasonOk} onClick={send}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{decision === "approve" ? "Setujui" : "Tolak"}</Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
        {phase.kind === "done" && <DialogFooter><Button onClick={() => onOpenChange(false)}>Selesai</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
