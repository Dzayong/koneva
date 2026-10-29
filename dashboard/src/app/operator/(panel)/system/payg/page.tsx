"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Save, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorSession, usePaygSettings, usePaygRevenue, useSavePaygSettings } from "@/hooks/use-operator";
import type { PaygRevenueInsights } from "@/lib/operator/types";

const PAYG_TIERS = [
  { name: "Mulai", usage: "Rp0–Rp499.999", api: 15, automatic: 20, ai: 50 },
  { name: "Berkembang", usage: "Rp500.000–Rp1.299.999", api: 14, automatic: 19, ai: 48 },
  { name: "Skala", usage: "Rp1.300.000–Rp2.499.999", api: 13, automatic: 18, ai: 46 },
  { name: "Tarif terbaik", usage: "Mulai Rp2.500.000", api: 12, automatic: 17, ai: 44 },
] as const;

const CATEGORY_LABEL: Record<string, string> = { api: "API", auto_reply: "Otomatis", ai_reply: "AI" };
const TIER_LABEL: Record<string, string> = { starter: "Mulai", growth: "Berkembang", scale: "Skala", max: "Terbaik" };

function rupiah(amount: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
}

export default function PaygSettingsPage() {
  const { can } = useOperatorSession();
  const settings = usePaygSettings(can("owner:insights"));
  if (!can("owner:insights")) return <ForbiddenState text="Pengaturan ini hanya untuk superadmin." />;
  if (settings.isLoading) return <LoadingBlock label="Memuat pengaturan PAYG..." />;
  if (settings.error || !settings.data) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  return <div className="mx-auto max-w-4xl space-y-8">
    <header>
      <p className="text-label text-primary">PENGATURAN SISTEM</p>
      <h1 className="text-display mt-2">PAYG & tarif pesan</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">PAYG menggantikan paket workspace. Pengguna mengisi saldo, lalu hanya pesan yang dikonfirmasi terkirim oleh WhatsApp yang ditagih.</p>
    </header>
    <PaygForm key={`${settings.data.enabled}-${settings.data.price_per_message_idr}`} initial={settings.data} />
    {settings.data.enabled && <RevenueInsights />}
  </div>;
}

function PaygForm({ initial }: { initial: { enabled: boolean; price_per_message_idr: number | null } }) {
  const save = useSavePaygSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await save.mutateAsync({ enabled, price_per_message_idr: initial.price_per_message_idr ?? 15 });
  };
  return <Card className="space-y-5 shadow-card">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Wallet className="h-5 w-5" aria-hidden /></div>
        <div><h2 className="font-semibold">Tarif progresif per kategori</h2><p className="text-sm text-muted-foreground">Tarif turun otomatis berdasarkan total pemakaian berbayar workspace.</p></div>
      </div>
      <Badge variant={enabled ? "default" : "outline"}>{enabled ? "Aktif" : "Belum aktif"}</Badge>
    </div>
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[1.4fr_repeat(3,1fr)] gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Tier pemakaian</span><span>API</span><span>Otomatis</span><span>AI</span>
        </div>
        {PAYG_TIERS.map((tier) => <div key={tier.name} className="grid grid-cols-[1.4fr_repeat(3,1fr)] gap-2 border-t px-3 py-3 text-sm">
          <div><p className="font-medium">{tier.name}</p><p className="text-xs text-muted-foreground">{tier.usage}</p></div>
          <span>Rp{tier.api}</span><span>Rp{tier.automatic}</span><span>Rp{tier.ai}</span>
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground">Tier dihitung dari akumulasi biaya pesan yang berhasil dikenai biaya. Tarif baru berlaku mulai pesan berikutnya setelah ambang tercapai; tier tertinggi tetap berlaku permanen.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Aktifkan PAYG dan hentikan checkout paket</label>
      <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">Saat PAYG diaktifkan, pengiriman baru ditolak bila saldo kurang. Pesan yang dipastikan gagal otomatis dikembalikan. Hasil pengiriman yang belum pasti tetap dikenai biaya dan tidak dikirim ulang otomatis untuk mencegah duplikasi.</div>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}Simpan pengaturan
      </Button>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-success">Pengaturan PAYG tersimpan.</p>}
    </form>
  </Card>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-xl border bg-card p-4">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="mt-1 text-xl font-semibold">{value}</p>
    {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
  </div>;
}

function RevenueInsights() {
  const { can } = useOperatorSession();
  const { data, isLoading, error, refetch } = usePaygRevenue(can("owner:insights"));
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div></div>;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return <RevenuePanel data={data} />;
}

function RevenuePanel({ data }: { data: PaygRevenueInsights }) {
  const { totals, funding, ai_cost_alert, revenue_by_category, workspaces } = data;
  return <div className="space-y-6">
    <div className="flex items-center gap-2">
      <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
      <h2 className="text-lg font-semibold">Pendapatan PAYG</h2>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Pendapatan" value={rupiah(totals.revenue_idr)} sub={`${totals.messages_charged.toLocaleString("id-ID")} pesan`} />
      <StatCard label="Estimasi biaya variabel" value={rupiah(totals.estimated_variable_cost_idr)} sub={`Margin ${totals.margin_percent}%`} />
      <StatCard label="Total dana masuk" value={rupiah(funding.total_funded_idr)} sub={`${funding.topup_count} top-up, ${rupiah(funding.total_vouchers_idr)} voucher`} />
      <StatCard label="Saldo belum terpakai" value={rupiah(funding.unspent_balance_idr)} sub="Total di semua workspace" />
    </div>

    {ai_cost_alert.warning && <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
      <div>
        <p className="font-medium text-amber-800 dark:text-amber-200">Harga jual AI mendekati batas bawah</p>
        <p className="mt-1 text-sm text-muted-foreground">Harga jual rata-rata AI: {rupiah(ai_cost_alert.avg_selling_price_idr)}. Batas bawah tier terbaik: {rupiah(ai_cost_alert.floor_price_idr)}. Pastikan biaya model/token AI tetap di bawah harga jual.</p>
      </div>
    </div>}

    <Card className="space-y-4 shadow-card">
      <h3 className="font-semibold">Pendapatan per kategori</h3>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Tertagih</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
              <TableHead className="text-right">Dikembalikan</TableHead>
              <TableHead className="text-right">Menunggu</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {revenue_by_category.map((c) => <TableRow key={c.billing_category}>
              <TableCell className="font-medium">{CATEGORY_LABEL[c.billing_category] ?? c.billing_category}</TableCell>
              <TableCell className="text-right">{c.captured.count.toLocaleString("id-ID")}</TableCell>
              <TableCell className="text-right font-medium">{rupiah(c.captured.idr)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{c.released.count.toLocaleString("id-ID")} ({rupiah(c.released.idr)})</TableCell>
              <TableCell className="text-right text-muted-foreground">{c.pending.count.toLocaleString("id-ID")} ({rupiah(c.pending.idr)})</TableCell>
            </TableRow>)}
            {revenue_by_category.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Belum ada transaksi.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>

    {workspaces.length > 0 && <Card className="space-y-4 shadow-card">
      <h3 className="font-semibold">Pemakaian per workspace</h3>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Pesan</TableHead>
              <TableHead className="text-right">Terpakai</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspaces.map((w) => <TableRow key={w.tenant_id}>
              <TableCell className="max-w-[180px] truncate font-medium">{w.name}</TableCell>
              <TableCell><Badge variant="outline">{TIER_LABEL[w.pricing_tier_code] ?? w.pricing_tier_code}</Badge></TableCell>
              <TableCell className="text-right">{w.captured_count.toLocaleString("id-ID")}</TableCell>
              <TableCell className="text-right">{rupiah(w.lifetime_spent_idr)}</TableCell>
              <TableCell className="text-right">{rupiah(w.available_idr)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </div>
    </Card>}
  </div>;
}
