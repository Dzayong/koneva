"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Users, UsersRound, Megaphone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { InboxDevice } from "@/lib/types";

type CreateKind = "group" | "community" | "channel" | "follow";

const actions: { id: CreateKind; label: string; description: string; Icon: typeof Users }[] = [
  { id: "group", label: "Grup", description: "Buat grup WhatsApp", Icon: Users },
  { id: "community", label: "Komunitas", description: "Kelompokkan beberapa grup", Icon: UsersRound },
  { id: "channel", label: "Saluran", description: "Buat saluran satu arah", Icon: Megaphone },
  { id: "follow", label: "Ikuti saluran", description: "Pakai tautan undangan", Icon: Link2 },
];

function parseParticipants(value: string): string[] {
  return value.split(/\r?\n/).map((phone) => phone.trim()).filter(Boolean);
}

export function CreateInboxConversationDialog({
  open,
  onOpenChange,
  devices,
  preferredDeviceKey,
  initialKind = "group",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: InboxDevice[];
  preferredDeviceKey?: string;
  initialKind?: CreateKind;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<CreateKind>("group");
  const [deviceKey, setDeviceKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [participants, setParticipants] = useState("");
  const [channelLink, setChannelLink] = useState("");
  const [pendingCommunity, setPendingCommunity] = useState<{ deviceKey: string; commandId: string } | null>(null);
  const onlineDevices = useMemo(() => devices.filter((device) => device.status === "online"), [devices]);
  const activeDeviceKey = onlineDevices.some((device) => device.device_key === deviceKey)
    ? deviceKey
    : onlineDevices.some((device) => device.device_key === preferredDeviceKey)
      ? preferredDeviceKey!
      : onlineDevices[0]?.device_key ?? "";

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setDeviceKey(preferredDeviceKey && onlineDevices.some((device) => device.device_key === preferredDeviceKey)
        ? preferredDeviceKey
        : onlineDevices[0]?.device_key ?? "");
    }
  }, [open, preferredDeviceKey, onlineDevices]);

  const create = useMutation({
    mutationFn: async () => {
      if (!activeDeviceKey) throw new Error("Pilih device WhatsApp yang sedang online.");
      if (kind === "group") return api.createWhatsAppGroup(activeDeviceKey, { name: name.trim(), participants: parseParticipants(participants) });
      if (kind === "community") return api.createWhatsAppCommunity(activeDeviceKey, { name: name.trim(), description: description.trim() });
      if (kind === "channel") return api.createWhatsAppChannel(activeDeviceKey, { name: name.trim(), description: description.trim() });
      return api.followWhatsAppChannel(activeDeviceKey, channelLink.trim());
    },
    onSuccess: async (result) => {
      if (kind === "community" && result && typeof result === "object" && "command_id" in result) {
        const commandId = String(result.command_id);
        setPendingCommunity({ deviceKey: activeDeviceKey, commandId });
        toast.success("Permintaan komunitas sedang diproses", { description: "Periksa status di sini sebelum mencoba membuat lagi." });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["whatsapp-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["whatsapp-channels"] }),
        queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      ]);
      toast.success(kind === "group" ? "Permintaan pembuatan grup dikirim ke WhatsApp."
        : kind === "community" ? "Permintaan komunitas dikirim ke WhatsApp."
          : kind === "channel" ? "Saluran berhasil dibuat."
            : "Saluran berhasil diikuti.");
      if (kind !== "community") onOpenChange(false);
      setName("");
      setDescription("");
      setParticipants("");
      setChannelLink("");
    },
    onError: (error) => toast.error("Tidak bisa memproses permintaan", {
      description: error instanceof Error ? error.message : "Coba lagi setelah memeriksa koneksi device.",
    }),
  });

  const checkCommunity = useMutation({
    mutationFn: () => {
      if (!pendingCommunity) throw new Error("Tidak ada permintaan komunitas yang perlu diperiksa.");
      return api.getDeviceCommand(pendingCommunity.deviceKey, pendingCommunity.commandId);
    },
    onSuccess: async (command) => {
      if (command.status === "done" && command.result != null) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["whatsapp-groups"] }),
          queryClient.invalidateQueries({ queryKey: ["inbox"] }),
        ]);
        setPendingCommunity(null);
        toast.success("Komunitas berhasil dibuat.");
      } else if (command.status === "failed" || command.status === "cancelled") {
        setPendingCommunity(null);
        toast.error("Komunitas tidak berhasil dibuat", { description: command.error?.replace(/^[A-Z_]+:\s*/, "") || "Periksa koneksi device, lalu coba lagi." });
      } else if (command.status === "done") {
        toast.error("WhatsApp belum mengonfirmasi hasilnya", { description: "Permintaan tetap ditahan agar tidak terkirim dua kali. Periksa daftar grup sebelum mencoba lagi." });
      } else {
        toast.info("Komunitas masih diproses", { description: "Tunggu sebentar, lalu periksa status lagi." });
      }
    },
    onError: (error) => toast.error("Status komunitas belum bisa diperiksa", { description: error instanceof Error ? error.message : "Coba periksa lagi sebentar." }),
  });

  const isNameAction = kind === "group" || kind === "community" || kind === "channel";
  const canSubmit = !!activeDeviceKey && !create.isPending && !checkCommunity.isPending && !(pendingCommunity && kind === "community") && (isNameAction ? !!name.trim() : !!channelLink.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat percakapan</DialogTitle>
          <DialogDescription>Buat grup, komunitas, atau saluran tanpa meninggalkan kotak masuk.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Jenis percakapan">
          {actions.map(({ id, label, description: helper, Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={kind === id} onClick={() => setKind(id)}
              className={`flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left transition-colors ${kind === id ? "border-primary bg-primary/5" : "hover:bg-muted/60"}`}>
              <Icon className={`h-4 w-4 shrink-0 ${kind === id ? "text-primary" : "text-muted-foreground"}`} />
              <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{helper}</span></span>
            </button>
          ))}
        </div>

        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (canSubmit) create.mutate(); }}>
          <div className="space-y-2">
            <Label htmlFor="inbox-create-device">Device WhatsApp</Label>
            <Select value={activeDeviceKey} onValueChange={setDeviceKey}>
              <SelectTrigger id="inbox-create-device"><SelectValue placeholder="Pilih device online" /></SelectTrigger>
              <SelectContent>{onlineDevices.map((device) => <SelectItem key={device.device_key} value={device.device_key}>{device.label || device.phone_number || device.device_key}</SelectItem>)}</SelectContent>
            </Select>
            {!onlineDevices.length && <p className="text-xs text-destructive">Tidak ada device online. Sambungkan device terlebih dahulu.</p>}
          </div>

          {isNameAction ? <>
            <div className="space-y-2">
              <Label htmlFor="inbox-create-name">{kind === "group" ? "Nama grup" : kind === "community" ? "Nama komunitas" : "Nama saluran"}</Label>
              <Input id="inbox-create-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={kind === "group" ? "Contoh: Tim toko" : kind === "community" ? "Contoh: Pelanggan toko" : "Contoh: Info toko"} required />
            </div>
            {kind === "group" ? <div className="space-y-2">
              <Label htmlFor="inbox-create-participants">Nomor anggota (opsional)</Label>
              <Textarea id="inbox-create-participants" value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder={"6281234567890\n6289876543210"} />
              <p className="text-xs text-muted-foreground">Gunakan kode negara tanpa tanda +, satu nomor per baris.</p>
            </div> : <div className="space-y-2">
              <Label htmlFor="inbox-create-description">Deskripsi (opsional)</Label>
              <Textarea id="inbox-create-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={512} placeholder="Tentang ruang ini" />
            </div>}
            {kind === "community" && <p className="text-xs text-muted-foreground">WhatsApp memproses pembuatan komunitas sebagai perintah. Periksa statusnya sebelum mengirim permintaan lain.</p>}
          </> : <div className="space-y-2">
            <Label htmlFor="inbox-create-channel-link">Tautan undangan saluran</Label>
            <Input id="inbox-create-channel-link" value={channelLink} onChange={(event) => setChannelLink(event.target.value)} placeholder="https://whatsapp.com/channel/..." required />
          </div>}

          {pendingCommunity && <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">Pembuatan komunitas masih menunggu konfirmasi.</p>
            <p className="text-xs text-muted-foreground">Jangan kirim permintaan baru agar komunitas tidak terbuat ganda.</p>
            <Button type="button" variant="outline" className="w-full" disabled={checkCommunity.isPending} onClick={() => checkCommunity.mutate()}>
              {checkCommunity.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {checkCommunity.isPending ? "Memeriksa…" : "Periksa status"}
            </Button>
          </div>}
          <Button type="submit" disabled={!canSubmit} className="w-full">
            {create.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Memproses…</>
              : kind === "group" ? "Buat grup" : kind === "community" ? "Buat komunitas" : kind === "channel" ? "Buat saluran" : "Ikuti saluran"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
