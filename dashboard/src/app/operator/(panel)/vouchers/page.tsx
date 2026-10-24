"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Plus, TicketPercent, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useCreateSignupVoucher, useDisableSignupVoucher, useOperatorSession, useSignupVouchers } from "@/hooks/use-operator";
import type { CreatedSignupVoucher } from "@/lib/operator/types";

const idr = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Tanpa batas waktu";

export default function SignupVouchersPage() {
  const { can } = useOperatorSession();
  const vouchers = useSignupVouchers(can("owner:insights"));
  if (!can("owner:insights")) return <ForbiddenState text="Voucher saldo hanya dapat dikelola superadmin." />;
  if (vouchers.isLoading) return <LoadingBlock label="Memuat voucher saldo..." />;
  if (vouchers.error || !vouchers.data) return <ErrorState error={vouchers.error} onRetry={() => void vouchers.refetch()} />;
  return <VoucherManager items={vouchers.data.items} />;
}

function VoucherManager({ items }: { items: Array<{ id: string; code_hint: string; credit_idr: number; max_redemptions: number; redemptions_count: number; active: boolean; expires_at: string | null; created_at: string; disabled_at: string | null }> }) {
  const create = useCreateSignupVoucher();
  const disable = useDisableSignupVoucher();
  const [credit, setCredit] = useState("20000");
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [issued, setIssued] = useState<CreatedSignupVoucher | null>(null);
  const [copied, setCopied] = useState(false);
  const [now] = useState(() => Date.now());

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIssued(null);
    setCopied(false);
    const result = await create.mutateAsync({
      credit_idr: Number(credit), max_redemptions: Number(maxRedemptions),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    }).catch(() => null);
    if (result) setIssued(result);
  };

  const copyCode = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.code);
    setCopied(true);
  };

  return <div className="mx-auto max-w-5xl space-y-6">
    <header>
      <p className="text-label text-primary">KHUSUS OWNER</p>
      <h1 className="text-display mt-2">Voucher saldo</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">Buat kode kredit untuk mahasiswa. Saldo masuk setelah pendaftar memverifikasi nomor WhatsApp.</p>
    </header>

    <Card className="space-y-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><TicketPercent className="h-5 w-5" aria-hidden /></div>
        <div><h2 className="font-semibold">Buat voucher</h2><p className="text-sm text-muted-foreground">Kode hanya ditampilkan satu kali setelah dibuat.</p></div>
      </div>
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={(event) => void submit(event)}>
        <label className="space-y-1.5 text-sm font-medium">Kredit saldo (rupiah)
          <input required type="number" min={1} max={100000000} step={1} value={credit} onChange={(event) => setCredit(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">Batas pemakaian
          <input required type="number" min={1} max={100000} step={1} value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">Berlaku sampai <span className="font-normal text-muted-foreground">(opsional)</span>
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" />
        </label>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={create.isPending || !Number.isInteger(Number(credit)) || Number(credit) < 1 || !Number.isInteger(Number(maxRedemptions)) || Number(maxRedemptions) < 1}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-2 h-4 w-4" aria-hidden />}Buat voucher
          </Button>
          {create.error && <p role="alert" className="mt-3 text-sm text-destructive">{create.error.message}</p>}
        </div>
      </form>
      {issued && <div role="status" className="rounded-lg border border-success/40 bg-success/5 p-4">
        <p className="font-semibold">Voucher berhasil dibuat</p>
        <p className="mt-1 text-sm text-muted-foreground">{idr(issued.credit_idr)} saldo · maksimal {issued.max_redemptions} akun · {dateTime(issued.expires_at)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-md border bg-background px-3 py-2 font-mono text-sm">{issued.code}</code>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyCode()}>{copied ? <Check className="mr-2 h-4 w-4" aria-hidden /> : <Copy className="mr-2 h-4 w-4" aria-hidden />}{copied ? "Tersalin" : "Salin kode"}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Simpan dan bagikan kode ini kepada penerima. Setelah meninggalkan halaman, kode lengkap tidak dapat dilihat lagi.</p>
      </div>}
    </Card>

    <Card className="space-y-4 shadow-card">
      <div><h2 className="font-semibold">Voucher yang pernah dibuat</h2><p className="text-sm text-muted-foreground">Kode lama ditampilkan sebagian. Menonaktifkan voucher menghentikan klaim baru dan tidak menarik saldo yang sudah masuk.</p></div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada voucher.</p> : <div className="divide-y">
        {items.map((voucher) => <div key={voucher.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-48 space-y-1">
            <code className="font-mono text-sm">{voucher.code_hint}</code>
            <p className="text-sm">{idr(voucher.credit_idr)} · {voucher.redemptions_count}/{voucher.max_redemptions} klaim</p>
            <p className="text-xs text-muted-foreground">Dibuat {dateTime(voucher.created_at)} · {voucher.expires_at ? `Berakhir ${dateTime(voucher.expires_at)}` : "Tanpa kedaluwarsa"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={voucher.active && voucher.redemptions_count < voucher.max_redemptions && (!voucher.expires_at || Date.parse(voucher.expires_at) > now) ? "default" : "outline"}>
              {!voucher.active ? "Nonaktif" : voucher.redemptions_count >= voucher.max_redemptions ? "Habis" : voucher.expires_at && Date.parse(voucher.expires_at) <= now ? "Kedaluwarsa" : "Aktif"}
            </Badge>
            {voucher.active && <Button type="button" variant="outline" size="sm" disabled={disable.isPending} onClick={() => disable.mutate(voucher.id)}><X className="mr-1.5 h-4 w-4" aria-hidden />Nonaktifkan</Button>}
          </div>
        </div>)}
      </div>}
      {disable.error && <p role="alert" className="text-sm text-destructive">{disable.error.message}</p>}
    </Card>
  </div>;
}
