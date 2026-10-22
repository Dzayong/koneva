"use client";

import { useState } from "react";
import { Loader2, Save, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorSession, usePaygSettings, useSavePaygSettings } from "@/hooks/use-operator";

export default function PaygSettingsPage() {
  const { can } = useOperatorSession();
  const settings = usePaygSettings(can("owner:insights"));
  if (!can("owner:insights")) return <ForbiddenState text="Pengaturan ini hanya untuk superadmin." />;
  if (settings.isLoading) return <LoadingBlock label="Memuat pengaturan PAYG..." />;
  if (settings.error || !settings.data) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  return <PaygForm key={`${settings.data.enabled}-${settings.data.price_per_message_idr}`} initial={settings.data} />;
}

function PaygForm({ initial }: { initial: { enabled: boolean; price_per_message_idr: number | null } }) {
  const save = useSavePaygSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [price, setPrice] = useState(String(initial.price_per_message_idr ?? 100));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await save.mutateAsync({ enabled, price_per_message_idr: Number(price) });
  };
  return <div className="mx-auto max-w-4xl space-y-6">
    <header>
      <p className="text-label text-primary">PENGATURAN SISTEM</p>
      <h1 className="text-display mt-2">PAYG & tarif pesan</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">PAYG menggantikan paket workspace. Pengguna mengisi saldo, lalu hanya pesan yang dikonfirmasi terkirim oleh WhatsApp yang ditagih.</p>
    </header>
    <Card className="space-y-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Wallet className="h-5 w-5" aria-hidden /></div>
          <div><h2 className="font-semibold">Tarif keluar per pesan</h2><p className="text-sm text-muted-foreground">Tarif berlaku sama untuk balasan biasa dan balasan AI.</p></div>
        </div>
        <Badge variant={enabled ? "default" : "outline"}>{enabled ? "Aktif" : "Belum aktif"}</Badge>
      </div>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1.5 text-sm font-medium">Tarif per pesan (rupiah)
          <input required type="number" min={1} max={100000} step={1} value={price} onChange={(event) => setPrice(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" />
          <span className="block text-xs font-normal text-muted-foreground">Saran harga uji awal: Rp100 per pesan berhasil. Sesuaikan setelah menghitung biaya infrastruktur dan provider AI.</span>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Aktifkan PAYG dan hentikan checkout paket</label>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">Saat PAYG diaktifkan, pesan antrean lama tanpa reservasi saldo ditandai gagal agar tidak terkirim gratis. Pengiriman baru ditolak bila saldo kurang. Pesan dengan hasil WhatsApp yang belum pasti tetap menahan saldo sampai diperiksa.</div>
        <Button type="submit" disabled={save.isPending || !Number.isInteger(Number(price)) || Number(price) < 1 || Number(price) > 100000}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}Simpan pengaturan
        </Button>
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p role="status" className="text-sm text-success">Pengaturan PAYG tersimpan.</p>}
      </form>
    </Card>
  </div>;
}
