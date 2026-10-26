"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, Radio, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useContactGroups, useScheduledCampaigns } from "@/hooks/use-contacts";
import { useDevices } from "@/hooks/use-devices";

const localDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const statusLabel: Record<string, string> = {
  scheduled: "Terjadwal", processing: "Sedang diproses", completed: "Selesai diproses", cancelled: "Dibatalkan",
};
const campaignFieldLabel: Record<string, string> = {
  name: "Nama campaign",
  group_id: "Grup kontak",
  device_key: "Device pengirim",
  scheduled_at: "Waktu kirim",
  message: "Pesan",
  media_url: "Media",
  media_type: "Jenis media",
};

function campaignValidationMessage(field: string, message: string): string {
  const label = campaignFieldLabel[field] ?? "Data campaign";
  if (message.includes("at least 5 minutes")) return "Atur waktu kirim minimal 5 menit dari sekarang.";
  if (message.includes("more than 90 days")) return "Jadwal tidak boleh lebih dari 90 hari ke depan.";
  if (message.includes("required") || message.includes("too_small")) return `${label} wajib diisi.`;
  if (message.includes("too_big") || message.includes("maximum")) return `${label} melebihi batas panjang yang diizinkan.`;
  if (field === "group_id") return "Pilih grup kontak yang tersedia.";
  if (field === "device_key") return "Pilih device pengirim yang tersedia.";
  if (field === "scheduled_at") return "Periksa kembali waktu pengiriman.";
  return `${label} belum valid.`;
}

function campaignErrorMessage(error: unknown): string {
  const responseError = error as {
    response?: { status?: number; data?: { error?: { code?: string; message?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } } };
  };
  const apiError = responseError?.response?.data?.error;
  const codeMessages: Record<string, string> = {
    CONTACT_GROUP_NOT_FOUND: "Grup kontak tidak ditemukan. Muat ulang halaman lalu pilih grup lagi.",
    DEVICE_NOT_FOUND: "Device pengirim tidak ditemukan. Muat ulang daftar device lalu pilih lagi.",
    DEVICE_OFFLINE: "Device pengirim sedang offline. Sambungkan device sebelum menjadwalkan campaign.",
    NO_CONSENTED_RECIPIENTS: "Belum ada kontak dengan izin aktif di grup ini. Periksa izin kontak sebelum menjadwalkan.",
    PLAN_INACTIVE: "Langganan workspace tidak aktif. Periksa halaman Tagihan untuk melanjutkan.",
  };
  if (apiError?.code && codeMessages[apiError.code]) return codeMessages[apiError.code];
  if (apiError?.details?.fieldErrors) {
    const errors = Object.entries(apiError.details.fieldErrors)
      .flatMap(([field, messages]) => messages.map((message) => campaignValidationMessage(field, message)));
    if (errors.length) return [...new Set(errors)].join(" ");
  }
  if (apiError?.details?.formErrors?.length) return "Data campaign belum valid. Periksa kembali isian formulir.";
  if (apiError?.code === "VALIDATION_ERROR") return "Data campaign belum valid. Periksa kembali nama, grup, device, waktu, dan pesan.";
  if (responseError?.response?.status && responseError.response.status >= 500) return "Server sedang bermasalah. Jadwal belum tersimpan; coba lagi beberapa saat.";
  return "Campaign belum dapat dijadwalkan. Periksa grup, device, waktu, dan koneksi lalu coba lagi.";
}

export default function CampaignsPage() {
  const { data: groups = [], isLoading: groupsLoading, isError: groupsError, refetch: refetchGroups } = useContactGroups();
  const { data: devices = [], isLoading: devicesLoading, isError: devicesError, refetch: refetchDevices } = useDevices();
  const { data: campaigns = [], isLoading, createCampaign, cancelCampaign } = useScheduledCampaigns();
  const onlineDevices = useMemo(() => devices.filter((device) => device.status === "online"), [devices]);
  const prerequisitesLoading = groupsLoading || devicesLoading;
  const prerequisitesError = groupsError || devicesError;
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => localDateTime(new Date(Date.now() + 10 * 60_000)));
  const [minimumScheduledAt] = useState(() => localDateTime(new Date(Date.now() + 6 * 60_000)));
  const [maximumScheduledAt] = useState(() => localDateTime(new Date(Date.now() + 90 * 24 * 60 * 60_000)));
  const [message, setMessage] = useState("");
  const selectedGroup = groups.find((group) => group.id === groupId);
  const selectedGroupOptedInCount = selectedGroup?.opted_in_count ?? 0;

  const submit = async () => {
    if (!name.trim() || !groupId || !deviceKey || !scheduledAt || !message.trim()) {
      toast.error("Lengkapi nama, grup, device, waktu, dan pesan terlebih dahulu");
      return;
    }
    const scheduledAtMs = new Date(scheduledAt).getTime();
    if (!Number.isFinite(scheduledAtMs) || scheduledAtMs < Date.now() + 5 * 60_000) {
      toast.error("Waktu campaign harus minimal 5 menit dari sekarang. Perbarui waktu kirim lalu coba lagi.");
      return;
    }
    if (scheduledAtMs > Date.now() + 90 * 24 * 60 * 60_000) {
      toast.error("Jadwal tidak boleh lebih dari 90 hari ke depan.");
      return;
    }
    try {
      const result = await createCampaign.mutateAsync({
        name: name.trim(), group_id: groupId, device_key: deviceKey,
        scheduled_at: new Date(scheduledAt).toISOString(), message,
      });
      toast.success("Campaign berhasil dijadwalkan", { description: `${result.recipient_count} kontak dengan consent aktif disimpan sebagai target.` });
      setName("");
      setMessage("");
    } catch (error) {
      toast.error(campaignErrorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display">Campaign Terjadwal</h1>
        <p className="text-muted-foreground">Jadwalkan pesan untuk grup kontak. Target disalin saat jadwal dibuat dan consent diperiksa lagi sebelum antre kirim.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Buat jadwal campaign</CardTitle></CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm md:col-span-2">
            <p className="font-medium">Sebelum menjadwalkan</p>
            {prerequisitesLoading ? (
              <p className="text-muted-foreground">Memeriksa grup kontak dan device…</p>
            ) : prerequisitesError ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-destructive">Data grup atau device gagal dimuat. Coba muat ulang sebelum membuat jadwal.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => { void refetchGroups(); void refetchDevices(); }}>
                  <RefreshCw className="mr-2 h-4 w-4" />Muat ulang
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3">
                  <span>{groups.length ? `${groups.length} grup kontak tersedia` : "Belum ada grup kontak"}</span>
                  <Button asChild variant="outline" size="sm"><Link href="/contacts">{groups.length ? "Kelola kontak" : "Buat grup"}</Link></Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3">
                  <span>{onlineDevices.length ? `${onlineDevices.length} device online` : "Belum ada device online"}</span>
                  <Button asChild variant="outline" size="sm"><Link href="/devices">Periksa device</Link></Button>
                </div>
              </div>
            )}
            {!prerequisitesLoading && !prerequisitesError && groups.length > 0 && (
              <p className="text-xs text-muted-foreground">Hanya kontak dengan izin menerima pesan yang masuk target. Pilih grup untuk melihat jumlah penerima yang bisa dijadwalkan.</p>
            )}
          </div>
          <div className="space-y-2"><Label htmlFor="campaign-name">Nama campaign</Label><Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Promo akhir pekan" /></div>
          <div className="space-y-2"><Label>Grup kontak</Label><Select value={groupId} onValueChange={setGroupId} disabled={prerequisitesLoading || prerequisitesError || groups.length === 0}><SelectTrigger className="w-full"><SelectValue placeholder={groupsLoading ? "Memuat grup…" : groups.length ? "Pilih grup" : "Belum ada grup"} /></SelectTrigger><SelectContent>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name} · {group.opted_in_count ?? 0}/{group.member_count} berizin</SelectItem>)}</SelectContent></Select>{selectedGroup && selectedGroupOptedInCount === 0 && <p className="text-xs text-destructive">Grup ini belum memiliki kontak dengan izin aktif, jadi belum bisa dijadwalkan. Perbarui izin kontak di halaman Kontak.</p>}</div>
          <div className="space-y-2"><Label>Device pengirim</Label><Select value={deviceKey} onValueChange={setDeviceKey} disabled={prerequisitesLoading || prerequisitesError || onlineDevices.length === 0}><SelectTrigger className="w-full"><SelectValue placeholder={devicesLoading ? "Memuat device…" : onlineDevices.length ? "Pilih device online" : "Belum ada device online"} /></SelectTrigger><SelectContent>{onlineDevices.map((device) => <SelectItem key={device.id} value={device.device_key}>{device.label || device.device_key}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="campaign-time">Waktu kirim (zona waktu lokal Anda)</Label><Input id="campaign-time" type="datetime-local" min={minimumScheduledAt} max={maximumScheduledAt} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="campaign-message">Pesan</Label><Textarea id="campaign-message" rows={5} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4096} placeholder="Tulis pesan. Gunakan {{nama}} untuk menyapa nama kontak." /><p className="text-xs text-muted-foreground">Pesan tetap mengikuti pemeriksaan consent, status langganan, kuota, dan batas pengiriman. Jadwal minimal 5 menit dan maksimal 90 hari ke depan.</p></div>
          <div className="md:col-span-2"><Button onClick={submit} disabled={createCampaign.isPending || prerequisitesLoading || prerequisitesError || groups.length === 0 || onlineDevices.length === 0 || (Boolean(selectedGroup) && selectedGroupOptedInCount === 0)}><CalendarClock className="mr-2 h-4 w-4" />{createCampaign.isPending ? "Menyimpan…" : "Jadwalkan campaign"}</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Campaign Anda</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? <p className="text-sm text-muted-foreground">Memuat campaign…</p> : campaigns.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Belum ada campaign terjadwal.</p> : campaigns.map((campaign) => (
            <div key={campaign.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{campaign.name}</p>
                <p className="text-sm text-muted-foreground">{campaign.group_name} · {campaign.recipient_count} penerima · {new Date(campaign.scheduled_at).toLocaleString("id-ID")}</p>
                <p className="text-xs text-muted-foreground">{statusLabel[campaign.status]} · {campaign.queued_count} antrean · {campaign.quota_hold_count} tertahan kuota · {campaign.failed_count} gagal{campaign.pending_count ? ` · ${campaign.pending_count} belum diproses` : ""}</p>
              </div>
              {campaign.status === "scheduled" && <Button variant="outline" size="sm" disabled={cancelCampaign.isPending} onClick={() => cancelCampaign.mutate(campaign.id, { onError: () => toast.error("Campaign tidak dapat dibatalkan karena mungkin sudah mulai diproses.") })}><XCircle className="mr-2 h-4 w-4" />Batalkan</Button>}
              {campaign.status === "processing" && <span className="inline-flex items-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-3 w-3 animate-spin" />Antrean dibuat bertahap</span>}
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground"><Radio className="mr-1 inline h-3 w-3" />KONEVA tidak menjamin pesan sampai ke penerima. Status campaign menunjukkan pesan masuk antrean, bukan status dibaca.</p>
    </div>
  );
}
