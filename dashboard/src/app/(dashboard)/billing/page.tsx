"use client";

import { useEffect, useState } from "react";
import { GraduationCap, Loader2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmailVerificationDialog } from "@/components/account/email-verification-dialog";
import { PlanCards, rupiah } from "@/components/billing/plan-cards";
import { useBilling, useCreateOrder, useDokuCheckout, usePaygTopupCheckout, useStudentRequest } from "@/hooks/use-billing";
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
const PAYG_TIER_LABEL: Record<string, string> = {
  starter: "Mulai",
  growth: "Berkembang",
  scale: "Skala",
  max: "Tarif terbaik",
};

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

function Payment({ invoice, payment, dokuReturned }: { invoice: Invoice; payment: BillingState["payment"]; dokuReturned: string | null }) {
  const checkout = useDokuCheckout();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleCheckout = () => {
    setCheckoutError(null);
    checkout.mutate(undefined, {
      onSuccess: (result) => { window.location.href = result.payment_url; },
      onError: (err) => {
        const f = apiFailure(err);
        setCheckoutError(
          f.code === "DOKU_NOT_CONFIGURED" ? "Pembayaran online belum tersedia di server ini."
            : f.code === "APP_PUBLIC_URL_NOT_CONFIGURED" ? "Konfigurasi server belum lengkap untuk pembayaran online."
            : f.code === "DOKU_CHECKOUT_FAILED" ? "DOKU menolak permintaan checkout. Coba lagi nanti."
            : f.message,
        );
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
        <p className="text-sm text-muted-foreground">Tagihan {invoice.number}</p>
        <p className="mt-1 text-2xl font-semibold">{rupiah(invoice.amount_idr)}</p>
        <p className="mt-1 text-sm">Jatuh tempo {formatDate(invoice.due_at)}</p>

        {dokuReturned && dokuReturned !== "cancel" && (
          <div role="status" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Menunggu konfirmasi pembayaran</p>
            <p className="mt-1 text-muted-foreground">Pembayaran sedang diproses DOKU. Status tagihan akan diperbarui otomatis setelah dikonfirmasi.</p>
          </div>
        )}
        {dokuReturned === "cancel" && (
          <div role="status" className="mt-4 rounded-lg border border-muted bg-muted/50 p-3 text-sm">
            <p className="font-medium">Pembayaran dibatalkan</p>
            <p className="mt-1 text-muted-foreground">Anda bisa mencoba lagi atau bayar manual di bawah.</p>
          </div>
        )}

        <Button className="mt-4 w-full" onClick={handleCheckout} disabled={checkout.isPending}>
          {checkout.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Bayar dengan DOKU
        </Button>
        {checkoutError && <p role="alert" className="mt-2 text-sm text-destructive">{checkoutError}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Status tagihan diperbarui otomatis setelah pembayaran diverifikasi DOKU — tidak perlu mengirim bukti.</p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-medium">Atau transfer manual</p>
        <div className="mt-3 whitespace-pre-line rounded-lg bg-muted/50 p-3 text-sm">{payment.instructions}</div>
        <p className="mt-3 text-sm text-muted-foreground">
          Setelah transfer, kirim bukti pembayaran dan nomor tagihan{payment.contact ? <> ke <span className="font-medium text-foreground">{payment.contact}</span></> : " ke penyedia layanan"}. Paket aktif setelah dikonfirmasi operator, tidak otomatis.
        </p>
      </div>
    </div>
  );
}

function StudentBox({ state }: { state: BillingState }) {
  const request = useStudentRequest();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (state.student.verified) return null;
  const eligible = state.subscription?.plan_id === "pelajar" && state.subscription.status === "active";
  const studentStatus = state.student.status;
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 font-semibold"><GraduationCap className="h-5 w-5" />Paket Pelajar</div>
      {!eligible ? (
        <p className="mt-2 text-sm text-muted-foreground">Bayar dan tunggu konfirmasi paket Pelajar terlebih dahulu. Layanan berbayar langsung aktif; bukti status pelajar diajukan setelahnya.</p>
      ) : studentStatus === "pending" ? (
        <p className="mt-2 text-sm text-muted-foreground">Bukti sedang diperiksa. Layanan berbayar tetap aktif selama menunggu.</p>
      ) : studentStatus === "rejected" ? (
        <p className="mt-2 text-sm text-destructive">Workspace ditangguhkan setelah bukti dinyatakan tidak valid dua kali. Hubungi koneva.id26@gmail.com.</p>
      ) : (
        <form className="mt-2 space-y-3" onSubmit={(e) => {
          e.preventDefault(); setError(null);
          request.mutate(note, { onError: (err) => { const f = apiFailure(err); setError(f.code === "NOT_A_STUDENT_EMAIL" ? "Gunakan email kampus atau sekolah (misalnya .ac.id) untuk akun Anda." : f.message); } });
        }}>
          {studentStatus === "correction_required" && (
            <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Bukti perlu diperbaiki paling lambat {state.student.correction_due_at ? formatDate(state.student.correction_due_at) : "dalam 7 hari"}. Layanan tetap aktif dan tidak ada refund. Jika tenggat lewat, harga perpanjangan kembali ke harga normal Pelajar.</p>
          )}
          {studentStatus === "expired" && (
            <p role="note" className="rounded-lg border bg-muted p-3 text-sm">Tenggat perbaikan sebelumnya lewat. Perpanjangan memakai harga normal Pelajar; Anda masih dapat mengajukan bukti.</p>
          )}
          {state.student.needs_resubmission && (
            <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Pengajuan verifikasi Anda sebelumnya belum sempat diperiksa karena sistem verifikasi diperbarui. Mohon ajukan ulang; pengajuan baru langsung masuk antrean pemeriksaan.</p>
          )}
          <p className="text-sm text-muted-foreground">Gunakan email kampus atau sekolah. Jelaskan bukti secara singkat (nama kampus/sekolah dan status aktif); jangan masukkan nomor identitas sensitif.</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Keterangan bukti status pelajar" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={request.isPending}>{request.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{studentStatus === "correction_required" || studentStatus === "expired" ? "Kirim bukti perbaikan" : "Ajukan verifikasi"}</Button>
        </form>
      )}
    </div>
  );
}

export default function BillingPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data, isLoading } = useBilling();
  const order = useCreateOrder();
  const topup = usePaygTopupCheckout();
  const [topupAmount, setTopupAmount] = useState("50000");
  const [created, setCreated] = useState<{ invoice: Invoice; payment: BillingState["payment"] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [checkoutReturned] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("duitku") ?? params.get("doku");
  });

  useEffect(() => {
    if (checkoutReturned) window.history.replaceState(null, "", "/billing");
  }, [checkoutReturned]);

  if (!permsLoading && !can("billing:manage")) return <p className="text-muted-foreground">Hanya pemilik workspace yang bisa membuka Tagihan.</p>;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;

  if (data.wallet.enabled) {
    const amount = Number(topupAmount);
    const startTopup = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        const checkout = await topup.mutateAsync(amount);
        window.location.href = checkout.payment_url;
      } catch { /* Mutation error is shown below. */ }
    };
    return <div className="mx-auto max-w-4xl space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Saldo</h1><p className="text-sm text-muted-foreground">Paket bulanan sudah digantikan saldo prabayar. Biaya dipotong saat pesan mulai dikirim dan otomatis dikembalikan jika WhatsApp memastikan pengiriman gagal.</p></div>
      {checkoutReturned && <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{checkoutReturned === "cancel" ? "Pembayaran dibatalkan. Saldo belum berubah." : "Menunggu konfirmasi pembayaran. Saldo akan masuk otomatis setelah pembayaran terverifikasi."}</div>}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Saldo tersedia</p><p className="mt-2 text-2xl font-semibold">{rupiah(data.wallet.available_idr)}</p></div>
        <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Pesan dikenai biaya</p><p className="mt-2 text-2xl font-semibold">{data.wallet.messages_charged.toLocaleString("id-ID")} pesan</p></div>
        <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Total terpakai</p><p className="mt-2 text-2xl font-semibold">{rupiah(data.wallet.spent_idr)}</p></div>
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Tier aktif</p>
          <p className="mt-2 text-2xl font-semibold">{PAYG_TIER_LABEL[data.wallet.pricing_tier] ?? data.wallet.pricing_tier}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.wallet.next_tier_at_idr === null
              ? "Tarif terbaik sudah berlaku permanen."
              : `${rupiah(data.wallet.amount_to_next_tier_idr ?? 0)} lagi menuju tarif berikutnya.`}
          </p>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Tarif aktif</h2>
        <p className="mt-1 text-sm text-muted-foreground">Setiap kategori dihitung terpisah. Semua pemakaian berbayar tetap membantu mencapai tier berikutnya.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">API developer</p><p className="mt-1 text-xl font-semibold">{rupiah(data.wallet.prices.api)}</p><p className="text-xs text-muted-foreground">per pesan</p></div>
          <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Balasan otomatis</p><p className="mt-1 text-xl font-semibold">{rupiah(data.wallet.prices.auto_reply)}</p><p className="text-xs text-muted-foreground">per pesan</p></div>
          <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Balasan AI</p><p className="mt-1 text-xl font-semibold">{rupiah(data.wallet.prices.ai_reply)}</p><p className="text-xs text-muted-foreground">per pesan</p></div>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" aria-hidden /><h2 className="font-semibold">Isi saldo lewat Duitku</h2></div>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void startTopup(event)}>
          <label className="sr-only" htmlFor="payg-topup-amount">Nominal isi saldo</label>
          <input id="payg-topup-amount" type="number" min={10000} max={10000000} step={1000} required value={topupAmount} onChange={(event) => setTopupAmount(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2" />
          <Button type="submit" disabled={topup.isPending || !Number.isInteger(amount) || amount < 10000 || amount > 10000000}>{topup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lanjutkan ke Duitku</Button>
        </form>
        {topup.error && <p role="alert" className="mt-3 text-sm text-destructive">{apiFailure(topup.error).code === "DUITKU_NOT_CONFIGURED" ? "Duitku sandbox belum dikonfigurasi di server." : apiFailure(topup.error).message}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Isi saldo Rp10.000–Rp10.000.000 per transaksi. Pesan gagal pasti otomatis mendapat pengembalian saldo. Jika hasil pengiriman tidak pasti, biaya tetap dihitung dan pesan tidak dikirim ulang otomatis.</p>
      </section>
      <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Pemakaian per device</h2>
        {data.wallet.devices.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Belum ada aktivitas pesan.</p> : <div className="mt-3 divide-y">{data.wallet.devices.map((device) => <div key={device.device_key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-mono">{device.device_key}</span><span>{device.messages_sent} berhasil · {device.messages_failed} gagal · {rupiah(device.charged_idr)}</span></div>)}</div>}
      </section>
      <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Riwayat isi saldo</h2>
        {data.wallet.recent_topups.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Belum ada isi saldo.</p> : <div className="mt-3 divide-y">{data.wallet.recent_topups.map((item) => <div key={item.invoice_number} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="font-mono">{item.invoice_number}</span><span>{rupiah(item.amount_idr)} · {item.status === "paid" ? "Lunas" : item.status === "unpaid" ? "Menunggu" : "Dibatalkan"}</span></div>)}</div>}
      </section>
      <p className="text-xs text-muted-foreground">Perangkat tidak lagi dibatasi oleh tingkatan paket. Jumlah kirim tetap mengikuti saldo dan perlindungan pengiriman KONEVA.</p>
    </div>;
  }

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

      {checkoutReturned && checkoutReturned !== "cancel" && !shown && (
        <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
          <p className="font-medium">Menunggu konfirmasi pembayaran</p>
          <p className="mt-1 text-sm text-muted-foreground">Jika Anda baru menyelesaikan pembayaran via DOKU, status akan diperbarui otomatis setelah diverifikasi.</p>
        </div>
      )}
      {shown && <Payment invoice={shown.invoice} payment={shown.payment} dokuReturned={checkoutReturned} />}

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
