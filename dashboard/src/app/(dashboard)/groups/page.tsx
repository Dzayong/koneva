"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CircleHelp, Loader2, Radio, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevices } from "@/hooks/use-devices";
import { api } from "@/lib/api";
import type { WhatsAppChannelSummary } from "@/lib/types";

function apiMessage(error: unknown): string {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
    if (response?.data?.error?.message) return response.data.error.message;
  }
  return error instanceof Error ? error.message : "Permintaan gagal. Coba lagi.";
}

export default function WhatsAppGroupsPage() {
  const { data: devices = [], isLoading: devicesLoading } = useDevices();
  const onlineDevices = useMemo(() => devices.filter((device) => device.status === "online"), [devices]);
  const [deviceKey, setDeviceKey] = useState("");
  const activeDevice = deviceKey || onlineDevices[0]?.device_key || "";
  const groups = useQuery({
    queryKey: ["whatsapp-groups", activeDevice],
    queryFn: () => api.getWhatsAppGroups(activeDevice),
    enabled: Boolean(activeDevice),
    retry: false,
    staleTime: 30_000,
  });
  const [channelLink, setChannelLink] = useState("");
  const [channel, setChannel] = useState<WhatsAppChannelSummary | null>(null);
  const channelLookup = useMutation({
    mutationFn: () => api.lookupWhatsAppChannel(activeDevice, channelLink.trim()),
    onSuccess: setChannel,
  });

  const communities = (groups.data ?? []).filter((group) => group.is_community);
  const regularGroups = (groups.data ?? []).filter((group) => !group.is_community);
  const communityNames = new Map(communities.map((community) => [community.id, community.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display">Grup, komunitas & saluran</h1>
          <p className="text-muted-foreground">Lihat grup dan komunitas yang diikuti nomor WhatsApp, atau periksa saluran dari tautan undangannya.</p>
        </div>
        <div className="w-full sm:w-72">
          <Label htmlFor="destination-device">Device WhatsApp</Label>
          <Select value={activeDevice} onValueChange={setDeviceKey} disabled={onlineDevices.length === 0}>
            <SelectTrigger id="destination-device" className="mt-2 w-full"><SelectValue placeholder="Pilih device online" /></SelectTrigger>
            <SelectContent>{onlineDevices.map((device) => <SelectItem key={device.id} value={device.device_key}>{device.label || device.device_key}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {onlineDevices.length === 0 && !devicesLoading && (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Sambungkan device WhatsApp terlebih dahulu untuk memuat grup dan memeriksa tautan saluran.</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div><CardTitle>Grup WhatsApp</CardTitle><p className="mt-1 text-sm text-muted-foreground">{regularGroups.length} grup pada device ini</p></div>
            <Button variant="outline" size="sm" onClick={() => void groups.refetch()} disabled={!activeDevice || groups.isFetching} aria-label="Muat ulang grup">
              <RefreshCw className={`mr-2 h-4 w-4 ${groups.isFetching ? "animate-spin" : ""}`} />Muat ulang
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.isLoading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Mengambil grup dari WhatsApp…</div>
              : groups.isError ? <p className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{apiMessage(groups.error)}</p>
                : regularGroups.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Tidak ada grup yang terdeteksi pada device ini.</p>
                  : regularGroups.map((group) => (
                    <div key={group.id} className="rounded-xl border p-4">
                      <div className="flex items-start gap-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium">{group.name}</p><p className="text-xs text-muted-foreground">{group.member_count} anggota{group.announcement_only ? " · hanya admin yang dapat mengirim" : ""}{group.parent_community_jid && ` · Komunitas: ${communityNames.get(group.parent_community_jid) ?? "tertaut"}`}</p>{group.description && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{group.description}</p>}</div></div>
                    </div>
                  ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Komunitas WhatsApp</CardTitle><p className="text-sm text-muted-foreground">Komunitas yang terdeteksi dari grup pada device terpilih</p></CardHeader>
          <CardContent className="space-y-3">
            {groups.isLoading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Mengambil komunitas…</div>
              : groups.isError ? <p className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{apiMessage(groups.error)}</p>
                : communities.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Tidak ada komunitas yang terdeteksi pada device ini.</p>
                  : communities.map((community) => {
                    const children = regularGroups.filter((group) => group.parent_community_jid === community.id);
                    return <div key={community.id} className="rounded-xl border p-4"><div className="flex items-start gap-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="font-medium">{community.name}</p><p className="text-xs text-muted-foreground">{community.member_count} anggota · {children.length} grup tertaut</p>{community.description && <p className="mt-2 text-sm text-muted-foreground">{community.description}</p>}</div></div>{children.length > 0 && <ul className="ml-7 mt-3 space-y-1 text-sm text-muted-foreground">{children.map((group) => <li key={group.id}>• {group.name}</li>)}</ul>}</div>;
                  })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Periksa saluran WhatsApp</CardTitle><p className="text-sm text-muted-foreground">Masukkan tautan undangan saluran untuk melihat nama, deskripsi, dan jumlah pengikut yang tersedia.</p></CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setChannel(null); channelLookup.mutate(); }}>
            <Input aria-label="Tautan saluran" value={channelLink} onChange={(event) => setChannelLink(event.target.value)} placeholder="https://whatsapp.com/channel/..." disabled={!activeDevice || channelLookup.isPending} />
            <Button type="submit" disabled={!activeDevice || !channelLink.trim() || channelLookup.isPending} className="shrink-0">{channelLookup.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memeriksa…</> : <><Radio className="mr-2 h-4 w-4" />Periksa saluran</>}</Button>
          </form>
          {channelLookup.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{apiMessage(channelLookup.error)}</p>}
          {channel && <div className="rounded-xl border p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div className="min-w-0"><p className="font-medium">{channel.name}</p><p className="text-xs text-muted-foreground">{channel.subscribers == null ? "Jumlah pengikut tidak tersedia" : `${channel.subscribers.toLocaleString("id-ID")} pengikut`} · {channel.verification === "VERIFIED" ? "Terverifikasi" : "Belum terverifikasi"}</p>{channel.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{channel.description}</p>}<p className="mt-2 break-all font-mono text-xs text-muted-foreground">{channel.id}</p></div></div></div>}
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />Baileys tidak menyediakan daftar global saluran yang diikuti akun. Untuk saat ini KONEVA memeriksa saluran dari tautan undangan; halaman ini belum mengikuti saluran atau menerbitkan kiriman.</p>
        </CardContent>
      </Card>
    </div>
  );
}
