"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Loader2, Radio, XCircle } from "lucide-react";
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

export default function CampaignsPage() {
  const { data: groups = [] } = useContactGroups();
  const { data: devices = [] } = useDevices();
  const { data: campaigns = [], isLoading, createCampaign, cancelCampaign } = useScheduledCampaigns();
  const onlineDevices = useMemo(() => devices.filter((device) => device.status === "online"), [devices]);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => localDateTime(new Date(Date.now() + 10 * 60_000)));
  const [message, setMessage] = useState("");

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
    try {
      const result = await createCampaign.mutateAsync({
        name: name.trim(), group_id: groupId, device_key: deviceKey,
        scheduled_at: new Date(scheduledAt).toISOString(), message,
      });
      toast.success("Campaign berhasil dijadwalkan", { description: `${result.recipient_count} kontak dengan consent aktif disimpan sebagai target.` });
      setName("");
      setMessage("");
    } catch (error) {
      const errorResponse = error as { response?: { data?: { error?: { message?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } } } };
      const apiError = errorResponse?.response?.data?.error;
      const validationDetails = apiError?.details?.fieldErrors
        ? Object.entries(apiError.details.fieldErrors).flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`)).join(" · ")
        : apiError?.details?.formErrors?.join(" · ");
      const messageText = [apiError?.message ?? "Gagal membuat campaign", validationDetails].filter(Boolean).join(" — ");
      toast.error(messageText);
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
          <div className="space-y-2"><Label htmlFor="campaign-name">Nama campaign</Label><Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Promo akhir pekan" /></div>
          <div className="space-y-2"><Label>Grup kontak</Label><Select value={groupId} onValueChange={setGroupId}><SelectTrigger className="w-full"><SelectValue placeholder="Pilih grup" /></SelectTrigger><SelectContent>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name} ({group.member_count})</SelectItem>)}</SelectContent></Select>{groups.length === 0 && <p className="text-xs text-muted-foreground">Buat grup terlebih dahulu di halaman Kontak.</p>}</div>
          <div className="space-y-2"><Label>Device pengirim</Label><Select value={deviceKey} onValueChange={setDeviceKey}><SelectTrigger className="w-full"><SelectValue placeholder="Pilih device online" /></SelectTrigger><SelectContent>{onlineDevices.map((device) => <SelectItem key={device.id} value={device.device_key}>{device.label || device.device_key}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="campaign-time">Waktu kirim (zona waktu lokal Anda)</Label><Input id="campaign-time" type="datetime-local" min={localDateTime(new Date(Date.now() + 6 * 60_000))} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="campaign-message">Pesan</Label><Textarea id="campaign-message" rows={5} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4096} placeholder="Tulis pesan. Gunakan {{nama}} untuk menyapa nama kontak." /><p className="text-xs text-muted-foreground">Pesan tetap mengikuti pemeriksaan consent, status langganan, kuota, dan batas pengiriman. Jadwal minimal 5 menit dan maksimal 90 hari ke depan.</p></div>
          <div className="md:col-span-2"><Button onClick={submit} disabled={createCampaign.isPending || groups.length === 0 || onlineDevices.length === 0}><CalendarClock className="mr-2 h-4 w-4" />{createCampaign.isPending ? "Menyimpan…" : "Jadwalkan campaign"}</Button></div>
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
              {campaign.status === "scheduled" && <Button variant="outline" size="sm" disabled={cancelCampaign.isPending} onClick={() => cancelCampaign.mutate(campaign.id)}><XCircle className="mr-2 h-4 w-4" />Batalkan</Button>}
              {campaign.status === "processing" && <span className="inline-flex items-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-3 w-3 animate-spin" />Antrean dibuat bertahap</span>}
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground"><Radio className="mr-1 inline h-3 w-3" />KONEVA tidak menjamin pesan sampai ke penerima. Status campaign menunjukkan pesan masuk antrean, bukan status dibaca.</p>
    </div>
  );
}
