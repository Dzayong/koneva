"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";

function CommPreferencesCard() {
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ["comm-preferences"],
    queryFn: () => api.getCommPreferences(),
  });
  const update = useMutation({
    mutationFn: (productUpdates: boolean) => api.updateCommPreferences(productUpdates),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-preferences"] }); toast.success("Preferensi disimpan"); },
    onError: (error) => toast.error("Gagal menyimpan", { description: apiFailure(error).message }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Komunikasi</CardTitle>
        <CardDescription>Notifikasi operasional dan keamanan selalu dikirim. Pilih apakah Anda ingin menerima info produk dan pembaruan fitur.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {prefs.isLoading ? <Skeleton className="h-6 w-48" /> : prefs.isError ? <p className="text-sm text-destructive">Gagal memuat preferensi.</p> : (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs.data?.product_updates ?? true}
              onChange={(e) => update.mutate(e.target.checked)} disabled={update.isPending} />
            Terima info produk dan pembaruan fitur
          </label>
        )}
        <p className="text-xs text-muted-foreground">Notifikasi keamanan (login, perangkat, pelanggaran) selalu aktif dan tidak bisa dinonaktifkan.</p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { data: tenant, isLoading, isError } = useQuery({ queryKey: ["tenant", "me"], queryFn: () => api.getMyTenant(), retry: false });
  const [draft, setDraft] = useState<string | null>(null);
  const webhook = draft ?? tenant?.webhook_url ?? "";
  const setWebhook = (value: string) => setDraft(value);

  const save = useMutation({
    mutationFn: (url: string) => api.updateWebhookUrl(url),
    onSuccess: () => { setDraft(null); queryClient.invalidateQueries({ queryKey: ["tenant", "me"] }); toast.success("Webhook disimpan"); },
    onError: (error) => toast.error("Gagal menyimpan webhook", { description: apiFailure(error).message }),
  });

  const canWebhook = can("webhooks:manage");
  const validUrl = webhook === "" || /^https?:\/\/.+/i.test(webhook.trim());
  const quotaPercent = tenant ? Math.min(100, (tenant.used_messages / Math.max(1, tenant.quota_messages)) * 100) : 0;
  const trial = tenant ? tenant.max_devices <= 1 && tenant.quota_messages <= 200 : false;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-display">Pengaturan</h2>
        <p className="mt-2 text-muted-foreground">Workspace, webhook, dan pemakaian.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Workspace</CardTitle><CardDescription>Identitas workspace ini</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? <Skeleton className="h-16 w-full" /> : isError || !tenant ? <p className="text-sm text-destructive">Gagal memuat data workspace.</p> : (
            <>
              <div className="space-y-2"><Label>Nama</Label><Input value={tenant.name} readOnly /></div>
              <div className="space-y-2"><Label>Email kontak</Label><Input value={tenant.email ?? ""} readOnly /></div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>Alamat yang menerima kabar saat pesan terkirim, sampai, dibaca, gagal, atau saat nomor bermasalah (tersambung, terputus, ditolak WhatsApp). Setiap kiriman ditandatangani. <Link href="/developers/webhooks" className="font-medium text-primary underline underline-offset-2">Panduan, kunci, dan tes webhook</Link></CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (validUrl) save.mutate(webhook.trim()); }}>
            <Input aria-label="Alamat webhook" placeholder="https://aplikasi-anda.com/webhook/wa" value={webhook} onChange={(e) => setWebhook(e.target.value)} disabled={!canWebhook} />
            <Button type="submit" disabled={!canWebhook || !validUrl || save.isPending || webhook === (tenant?.webhook_url ?? "")}>Simpan</Button>
          </form>
          {!validUrl && <p role="alert" className="text-sm text-destructive">Alamat harus diawali http:// atau https://</p>}
          {!canWebhook && <p className="text-sm text-muted-foreground">Peran Anda hanya bisa melihat pengaturan ini.</p>}
          <p className="text-xs text-muted-foreground">Kosongkan lalu simpan untuk mematikan webhook.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pemakaian</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? <Skeleton className="h-4 w-full" /> : isError || !tenant ? <p className="text-sm text-destructive">Gagal memuat pemakaian.</p> : (
            <>
              <Progress value={quotaPercent} aria-label="Pemakaian kuota pesan" />
              <p className="text-sm text-muted-foreground">{tenant.used_messages.toLocaleString("id-ID")} dari {tenant.quota_messages.toLocaleString("id-ID")} pesan terpakai. Maksimal {tenant.max_devices} nomor.</p>
              {trial && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Workspace ini masih uji coba. Untuk menambah nomor atau pesan, hubungi penyedia layanan; paket dan tagihan saat ini diatur manual.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <CommPreferencesCard />
    </div>
  );
}
