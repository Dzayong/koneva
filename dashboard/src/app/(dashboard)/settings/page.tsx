"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { apiFailure } from "@/lib/errors";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { can, legacy } = usePermissions();
  const { data: tenant, isLoading, isError } = useQuery({ queryKey: ["tenant", "me"], queryFn: () => api.getMyTenant(), retry: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  const copyKey = async () => {
    if (!tenant?.api_key) return;
    const ok = await copyText(tenant.api_key);
    setCopied(ok);
    if (ok) { toast.success("Tersalin"); setTimeout(() => setCopied(false), 2000); }
  };

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
          <CardDescription>Alamat yang menerima kabar saat pesan terkirim, sampai, dibaca, gagal, atau saat nomor bermasalah (tersambung, terputus, ditolak WhatsApp). Setiap kiriman ditandatangani.</CardDescription>
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

      {legacy && tenant?.api_key && (
        <Card>
          <CardHeader>
            <CardTitle>API key lama</CardTitle>
            <CardDescription>Anda masuk dengan API key tenant, cara lama yang memberi akses penuh. Sebaiknya buat akun dan kunci dengan izin terbatas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input value={tenant.api_key} readOnly type="password" className="font-mono" aria-label="API key lama" />
              <Button variant="outline" size="icon" onClick={copyKey} aria-label="Salin API key lama">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
