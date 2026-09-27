"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { rupiah } from "@/components/billing/plan-cards";
import { ReauthPrompt } from "@/components/operator/reauth-prompt";
import { InvoiceStatusBadge } from "@/components/operator/status-badges";
import { OperatorApiError } from "@/lib/operator/errors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmPayment } from "@/hooks/use-operator";
import { useGuardedSubmit } from "@/hooks/use-guarded-submit";
import { operatorErrorText } from "@/lib/operator/errors";
import type { ConfirmPaymentInput, ConfirmPaymentResult, InvoiceDetail } from "@/lib/operator/types";
import { formatDate } from "@/lib/utils";

const METHODS: Array<[value: string, label: string]> = [["transfer", "Transfer bank"], ["ewallet", "Dompet digital"], ["qris", "QRIS"], ["tunai", "Tunai"], ["lainnya", "Lainnya"]];

/**
 * Two steps (fill in, then re-check) before anything is sent. One idempotency key belongs to one final payload:
 * after an ambiguous result the form locks and a retry reuses the same key, so it can never confirm twice.
 * Success is only shown after the server answered 2xx.
 */
export function ConfirmPaymentDialog({ invoice, open, onOpenChange, onRefresh }: {
  invoice: InvoiceDetail; open: boolean; onOpenChange: (open: boolean) => void; onRefresh: () => Promise<InvoiceDetail | undefined>;
}) {
  const { phase, run, backToEdit, reset } = useGuardedSubmit<ConfirmPaymentResult>();
  const confirm = useConfirmPayment(invoice.id);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [latest, setLatest] = useState<InvoiceDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const input: ConfirmPaymentInput = {
    method, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
    expected: { amount_idr: invoice.amount_idr, version: invoice.version },
  };
  const busy = phase.kind === "submitting";
  const locked = busy || phase.kind === "unknown" || phase.kind === "done";

  const send = () => void run({ invoice_id: invoice.id, ...input }, (key) => confirm.mutateAsync({ input, key }));
  const refresh = async () => {
    setRefreshing(true);
    try { setLatest((await onRefresh()) ?? null); } finally { setRefreshing(false); }
  };
  const close = () => { if (!busy) onOpenChange(false); };
  const startOver = () => { reset(); setStep("edit"); setChecked(false); setLatest(null); };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => { if (locked) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Konfirmasi pembayaran</DialogTitle>
          <DialogDescription>Lakukan hanya setelah Anda memeriksa bukti pembayaran. Paket langsung aktif dan tindakan ini tercatat di audit.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><span className="font-mono">{invoice.number}</span><InvoiceStatusBadge status={invoice.status} /></div>
          <p className="mt-1">{invoice.workspace.name} · {invoice.plan.name} ({invoice.cycle === "yearly" ? "tahunan" : "bulanan"})</p>
          <p className="mt-1 text-lg font-semibold">{rupiah(invoice.amount_idr)}</p>
        </div>

        {phase.kind === "done" ? (
          <div role="status" className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />Pembayaran dikonfirmasi</p>
            <p>Invoice {phase.result.invoice.number} kini <strong>Lunas</strong>{phase.result.subscription ? `; paket ${phase.result.subscription.plan} aktif sampai ${phase.result.subscription.period_end ? formatDate(phase.result.subscription.period_end) : "—"}` : ""}.</p>
          </div>
        ) : phase.kind === "conflict" ? (
          <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4" aria-hidden />{operatorErrorText(phase.error)}</p>
            {phase.error.code === "INVOICE_NOT_PAYABLE" && (
              <p>Status sekarang: <strong>{String(phase.error.details["current_status"] ?? "—")}</strong>
                {typeof (phase.error.details["confirmed_by"] as { name?: string } | undefined)?.name === "string" ? <> oleh {(phase.error.details["confirmed_by"] as { name: string }).name}</> : null}
                {typeof phase.error.details["paid_at"] === "string" ? <> pada {formatDate(phase.error.details["paid_at"])}</> : null}.</p>
            )}
            {phase.error.code === "DUPLICATE_REFERENCE" && typeof phase.error.details["existing_invoice_number"] === "string" && <p>Dipakai pada invoice {phase.error.details["existing_invoice_number"]}.</p>}
          </div>
        ) : phase.kind === "failed" && phase.error instanceof OperatorApiError && phase.error.kind === "reauth_required" ? (
          <ReauthPrompt onSignedIn={send} />
        ) : phase.kind === "failed" ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{operatorErrorText(phase.error)}</p>
        ) : phase.kind === "unknown" ? (
          <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4" aria-hidden />Hasil belum pasti</p>
            <p>Server tidak memberi jawaban yang jelas, jadi konfirmasi mungkin sudah tersimpan. <strong>Coba lagi memakai kunci yang sama</strong> aman dilakukan dan tidak akan mengonfirmasi dua kali. Atau periksa status invoice.</p>
            {latest && latest.status === "paid" && <p className="font-medium">Status terbaru: Lunas{latest.confirmed_by ? `, dikonfirmasi ${latest.confirmed_by.name}` : ""}. Periksa audit untuk memastikan itu tindakan Anda.</p>}
            {latest && latest.status !== "paid" && <p>Status terbaru: belum lunas.</p>}
          </div>
        ) : null}

        {phase.kind !== "done" && (step === "edit" ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (checked) setStep("review"); }}>
            <div className="space-y-1.5">
              <Label htmlFor="cp-method">Metode pembayaran</Label>
              <select id="cp-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={locked} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="cp-ref">Referensi (opsional)</Label><Input id="cp-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} disabled={locked} placeholder="Nomor transaksi atau kode bukti" /></div>
            <div className="space-y-1.5"><Label htmlFor="cp-note">Catatan (opsional)</Label><Textarea id="cp-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} disabled={locked} /></div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={locked} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />Saya sudah memeriksa bukti pembayaran sebesar <strong>{rupiah(invoice.amount_idr)}</strong> untuk {invoice.number}.</label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>Batal</Button>
              <Button type="submit" disabled={!checked || locked}>Periksa ulang</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border p-3 text-sm">
              <p className="mb-1 font-medium">Periksa ulang sebelum mengirim</p>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>Metode: <span className="text-foreground">{METHODS.find(([v]) => v === method)?.[1]}</span></li>
                <li>Referensi: <span className="text-foreground">{reference.trim() || "—"}</span></li>
                <li>Catatan: <span className="text-foreground">{note.trim() || "—"}</span></li>
                <li>Efek: invoice <span className="text-foreground">Lunas</span> dan paket <span className="text-foreground">{invoice.plan.name}</span> diaktifkan.</li>
              </ul>
            </div>
            <DialogFooter className="gap-2">
              {phase.kind === "unknown" ? (
                <>
                  <Button type="button" variant="outline" disabled={refreshing} onClick={() => void refresh()}>{refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Periksa status invoice</Button>
                  <Button type="button" onClick={send}>Coba lagi (aman diulang)</Button>
                </>
              ) : phase.kind === "failed" && phase.error.kind === "reauth_required" ? (
                <Button type="button" variant="ghost" onClick={close}>Batal</Button>
              ) : phase.kind === "conflict" || phase.kind === "failed" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => { backToEdit(); setStep("edit"); }}>Kembali mengubah</Button>
                  <Button type="button" disabled={refreshing} onClick={() => void refresh().then(() => { startOver(); onOpenChange(false); })}>{refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Muat ulang data</Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep("edit")}>Kembali</Button>
                  <Button type="button" disabled={busy} onClick={send}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Konfirmasi pembayaran</Button>
                </>
              )}
            </DialogFooter>
          </div>
        ))}
        {phase.kind === "done" && <DialogFooter><Button onClick={() => { onOpenChange(false); }}>Selesai</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
