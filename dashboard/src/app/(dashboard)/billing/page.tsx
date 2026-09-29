"use client";

import { useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmailVerificationDialog } from "@/components/account/email-verification-dialog";
import { PlanCards, rupiah } from "@/components/billing/plan-cards";
import { useBilling, useCreateOrder, useStudentRequest } from "@/hooks/use-billing";
import { usePermissions } from "@/hooks/use-me";
import { apiFailure } from "@/lib/errors";
import type { BillingState, Invoice, PublicPlan } from "@/lib/types";
import { formatDate } from "@/lib/utils";

// Annual checkout is closed for new orders (T1.1); only monthly is offered here. An existing yearly
// subscription's own cycle still reads correctly from `sub.cycle` and its invoice history, unaffected by this.
const MONTHLY_ONLY = "monthly" as const;

const STATUS_LABEL: Record<string, string> = {
  trial: "Masa percobaan", active: "Aktif", past_due: "Terlambat bayar", suspended: "Dihentikan sementara", expired: "Berakhir", cancelled: "Dibatalkan",
};
const INVOICE_LABEL: Record<Invoice["status"], string> = { unpaid: "Belum dibayar", paid: "Lunas", void: "Dibatalkan" };

function UsageRow({ label, used, limit, headline }: { label: string; used: number; limit: number | null; headline?: string | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{headline ?? `${used.toLocaleString("id-ID")}${limit ? ` / ${limit.toLocaleString("id-ID")}` : ""}`}</span>
      </div>
      {limit ? <Progress value={pct} /> : null}
    </div>
  );
}

/** T1.1 meter: usage, limit, reset time, and why OTP/transactional sends don't move the bar. Shows a clear
 * upgrade path (not a silent drop) the moment anything is held for lack of quota. */
function MessageMeter({ usage }: { usage: BillingState["usage"] }) {
  return (
    <div className="space-y-2">
      <UsageRow label="Pesan bulan ini" used={usage.messages_used} limit={usage.messages_limit} headline={usage.quota_headline} />
      {usage.quota_note && <p className="text-xs text-muted-foreground">{usage.quota_note}</p>}
      <p className="text-xs text-muted-foreground">
        {usage.resets_at && `Direset ${formatDate(usage.resets_at)}.`}{" "}
        {usage.exempt_used > 0 && `${usage.exempt_used.toLocaleString("id-ID")} pesan OTP/transaksional bulan ini tidak dihitung dalam kuota.`}
      </p>
      {usage.messages_held > 0 && (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{usage.messages_held.toLocaleString("id-ID")} pesan tertahan menunggu kuota</p>
          <p className="mt-1 text-muted-foreground">
            Kuota bulan ini sudah habis. Pesan tetap tersimpan dan akan otomatis terkirim begitu kuota tersedia lagi (naik paket, atau reset periode berikutnya) — tidak ada yang dibuang.
            {" "}Naik paket di bawah untuk mengirim segera.
          </p>
        </div>
      )}
    </div>
  );
}

function Payment({ invoice, payment }: { invoice: Invoice; payment: BillingState["payment"] }) {
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
      <p className="text-sm text-muted-foreground">Tagihan {invoice.number}</p>
      <p className="mt-1 text-2xl font-semibold">{rupiah(invoice.amount_idr)}</p>
      <p className="mt-1 text-sm">Jatuh tempo {formatDate(invoice.due_at)}</p>
      <div className="mt-4 whitespace-pre-line rounded-lg bg-background p-3 text-sm">{payment.instructions}</div>
      <p className="mt-3 text-sm text-muted-foreground">
        Setelah membayar, kirim bukti pembayaran dan nomor tagihan{payment.contact ? <> ke <span className="font-medium text-foreground">{payment.contact}</span></> : " ke penyedia layanan"}. Paket aktif setelah pembayaran dikonfirmasi, tidak otomatis.
      </p>
    </div>
  );
}

function StudentBox({ state }: { state: BillingState }) {
  const request = useStudentRequest();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (state.student.verified) return null;
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 font-semibold"><GraduationCap className="h-5 w-5" />Paket Pelajar</div>
      {state.student.requested ? (
        <p className="mt-2 text-sm text-muted-foreground">Permintaan verifikasi sudah dikirim dan sedang diperiksa. Anda bisa memesan paket Pelajar setelah disetujui.</p>
      ) : (
        <form className="mt-2 space-y-3" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          request.mutate(note, { onError: (err) => { const f = apiFailure(err); setError(f.code === "NOT_A_STUDENT_EMAIL" ? "Gunakan email kampus atau sekolah (misalnya .ac.id) untuk akun Anda." : f.message); } });
        }}>
          {state.student.needs_resubmission && (
            <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Pengajuan verifikasi Anda sebelumnya belum sempat diperiksa karena sistem verifikasi diperbarui. Mohon ajukan ulang; pengajuan baru langsung masuk antrean pemeriksaan.</p>
          )}
          <p className="text-sm text-muted-foreground">Paket Pelajar butuh verifikasi. Akun Anda harus memakai email kampus atau sekolah; tambahkan keterangan singkat (nama kampus, NIM) bila perlu.</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Nama kampus / sekolah, NIM" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={request.isPending}>{request.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ajukan verifikasi</Button>
        </form>
      )}
    </div>
  );
}

export default function BillingPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data, isLoading } = useBilling();
  const order = useCreateOrder();
  const [created, setCreated] = useState<{ invoice: Invoice; payment: BillingState["payment"] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);

  if (!permsLoading && !can("billing:manage")) return <p className="text-muted-foreground">Hanya pemilik workspace yang bisa membuka Tagihan.</p>;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;

  const sub = data.subscription;
  const unpaid = data.invoices.find((i) => i.status === "unpaid");
  const shown = created ?? (unpaid ? { invoice: unpaid, payment: data.payment } : null);

  const choose = (plan: PublicPlan) => {
    setError(null);
    order.mutate({ plan: plan.id, cycle: MONTHLY_ONLY }, {
      onSuccess: setCreated,
      onError: (err) => {
        const f = apiFailure(err);
        if (f.code === "EMAIL_NOT_VERIFIED") { setError("Verifikasi email Anda dulu sebelum memesan paket."); setVerifyOpen(true); return; }
        setError(f.code === "STUDENT_NOT_VERIFIED" ? "Paket Pelajar butuh verifikasi dulu. Ajukan lewat kotak di bawah." : f.code === "PRICE_NOT_FINAL" ? "Harga paket ini belum final, belum bisa dipesan." : f.message);
      },
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <EmailVerificationDialog open={verifyOpen} onOpenChange={setVerifyOpen} onVerified={() => setError(null)} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tagihan</h1>
        <p className="text-sm text-muted-foreground">Paket, pemakaian, dan pembayaran workspace Anda.</p>
      </div>

      {sub && (
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Paket {sub.plan_name}</h2>
            <Badge variant={sub.status === "active" || sub.status === "trial" ? "default" : "destructive"}>{STATUS_LABEL[sub.status] ?? sub.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {sub.period_end ? `${sub.status === "trial" ? "Percobaan berakhir" : "Berlaku sampai"} ${formatDate(sub.period_end)}` : "Tanpa batas waktu"}
            {sub.status === "past_due" ? `. Masa tenggang ${sub.grace_days} hari sejak jatuh tempo.` : ""}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <MessageMeter usage={data.usage} />
            <UsageRow label="Nomor" used={data.usage.devices_used} limit={data.usage.devices_limit} />
            <UsageRow label="Anggota tim" used={data.usage.members_used} limit={data.usage.members_limit} />
          </div>
        </section>
      )}

      {shown && <Payment invoice={shown.invoice} payment={shown.payment} />}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Pilih atau ganti paket</h2>
        </div>
        <p className="text-xs text-muted-foreground">Semua paket ditagih bulanan. Checkout tahunan sudah ditutup untuk pesanan baru.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <PlanCards plans={data.plans} cycle={MONTHLY_ONLY} currentPlanId={sub?.plan_id} onChoose={choose} busyPlanId={order.isPending ? order.variables?.plan : null} />
        {data.plans.some((p) => !p.price_is_final) && <p className="text-xs text-muted-foreground">Sebagian harga masih dalam penetapan dan belum bisa dipesan.</p>}
      </section>

      <StudentBox state={data} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Riwayat tagihan</h2>
        {data.invoices.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada tagihan.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Nomor</TableHead><TableHead>Paket</TableHead><TableHead>Jumlah</TableHead><TableHead>Status</TableHead><TableHead>Tanggal</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.number}</TableCell>
                  <TableCell>{i.plan_id} · {i.cycle === "monthly" ? "bulanan" : "tahunan"}</TableCell>
                  <TableCell>{rupiah(i.amount_idr)}</TableCell>
                  <TableCell>{INVOICE_LABEL[i.status]}</TableCell>
                  <TableCell>{formatDate(i.paid_at ?? i.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
