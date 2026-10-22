"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CircleHelp, Loader2, Radio, RefreshCw, Users, Megaphone, MessagesSquare, Plus, Send, Settings2, Link2, Camera, MessageCircle, Reply, Pencil, Copy, UserPlus, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDevices } from "@/hooks/use-devices";
import { api } from "@/lib/api";
import type { WhatsAppChannelSummary, WhatsAppGroupSummary } from "@/lib/types";
import { toast } from "sonner";

type AdminOperation =
  | { kind: "group.create"; name: string; participants: string[] }
  | { kind: "group.update"; jid: string; name?: string; description?: string }
  | { kind: "group.members"; jid: string; action: "add" | "remove" | "promote" | "demote"; participants: string[] }
  | { kind: "group.settings"; jid: string; settings: { announcement_only?: boolean; restricted?: boolean; member_add_mode?: "admin_add" | "all_member_add"; join_approval?: boolean; ephemeral_duration?: number } }
  | { kind: "group.join-requests.update"; jid: string; action: "approve" | "reject"; participants: string[] }
  | { kind: "group.invite.revoke"; jid: string }
  | { kind: "group.picture"; jid: string; image_base64: string }
  | { kind: "group.leave"; jid: string }
  | { kind: "community.create"; name: string; description: string }
  | { kind: "community.update"; jid: string; name?: string; description?: string }
  | { kind: "community.link"; jid: string; group_jid: string; action: "link" | "unlink" }
  | { kind: "community.leave"; jid: string };
type ChannelOperation =
  | { kind: "follow"; link: string }
  | { kind: "create"; name: string; description: string }
  | { kind: "post"; jid: string; payload: { kind: "text" | "image" | "video"; text?: string; media_url?: string; caption?: string } }
  | { kind: "update"; jid: string; name?: string; description?: string }
  | { kind: "unfollow"; jid: string };

function parseParticipants(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(/\r?\n/).map((phone) => phone.trim()).filter(Boolean);
}

async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser tidak bisa memproses gambar ini.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const base64 = canvas.toDataURL("image/jpeg", 0.78).split(",")[1] ?? "";
  if (!base64 || base64.length > 390_000) throw new Error("Ukuran foto masih terlalu besar. Pilih gambar yang lebih kecil.");
  return base64;
}

function runAdminOperation(device: string, operation: AdminOperation): Promise<unknown> {
  switch (operation.kind) {
    case "group.create": return api.createWhatsAppGroup(device, { name: operation.name, participants: operation.participants });
    case "group.update": return api.updateWhatsAppGroup(device, operation.jid, { name: operation.name, description: operation.description });
    case "group.members": return api.manageWhatsAppGroupMembers(device, operation.jid, { action: operation.action, participants: operation.participants });
    case "group.settings": return api.updateWhatsAppGroupSettings(device, operation.jid, operation.settings);
    case "group.join-requests.update": return api.updateWhatsAppGroupJoinRequests(device, operation.jid, { action: operation.action, participants: operation.participants });
    case "group.invite.revoke": return api.revokeWhatsAppGroupInvite(device, operation.jid);
    case "group.picture": return api.updateWhatsAppGroupPicture(device, operation.jid, operation.image_base64);
    case "group.leave": return api.leaveWhatsAppGroup(device, operation.jid);
    case "community.create": return api.createWhatsAppCommunity(device, { name: operation.name, description: operation.description });
    case "community.update": return api.updateWhatsAppCommunity(device, operation.jid, { name: operation.name, description: operation.description });
    case "community.link": return api.setCommunityGroupLink(device, operation.jid, { group_jid: operation.group_jid, action: operation.action });
    case "community.leave": return api.leaveWhatsAppCommunity(device, operation.jid);
  }
}

function apiMessage(error: unknown): string {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
    if (response?.data?.error?.message) return response.data.error.message;
  }
  return error instanceof Error ? error.message : "Permintaan gagal. Coba lagi.";
}

class CommunityCommandError extends Error {
  constructor(message: string, readonly terminal: boolean) { super(message); }
}

async function createCommunityAndWait(device: string, payload: { name: string; description: string }, onQueued: (id: string) => void): Promise<unknown> {
  const queued = await api.createWhatsAppCommunity(device, payload);
  onQueued(queued.command_id);
  const deadline = Date.now() + 180_000;
  let statusReadFailures = 0;
  while (Date.now() < deadline) {
    try {
      const command = await api.getDeviceCommand(device, queued.command_id);
      statusReadFailures = 0;
      if (command.status === "done") {
        if (command.result == null) throw new CommunityCommandError("WhatsApp tidak mengonfirmasi pembuatan komunitas. Periksa daftar sebelum mencoba lagi.", true);
        return command.result;
      }
      if (command.status === "failed" || command.status === "cancelled") {
        throw new CommunityCommandError(command.error?.replace(/^[A-Z_]+:\s*/, "") ?? "Perintah pembuatan komunitas gagal.", true);
      }
    } catch (error) {
      if (error instanceof CommunityCommandError) throw error;
      statusReadFailures += 1;
      if (statusReadFailures >= 8) throw new CommunityCommandError("Status perintah belum bisa diperiksa. Jangan kirim ulang; gunakan Periksa status sebelum mencoba lagi.", false);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new CommunityCommandError("Perintah masih belum selesai. Jangan buat komunitas lagi; gunakan Periksa status beberapa saat lagi.", false);
}

function GroupWorkspace({ deviceKey, groups, isLoading, error }: { deviceKey: string; groups: WhatsAppGroupSummary[]; isLoading: boolean; error?: unknown }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberNumbers, setMemberNumbers] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [text, setText] = useState("");
  const [replyId, setReplyId] = useState<string | null>(null);
  const selected = groups.find((group) => group.id === selectedId) ?? groups[0];
  const jid = selected?.id ?? "";

  const details = useQuery({ queryKey: ["whatsapp-group-details", deviceKey, jid], queryFn: () => api.getWhatsAppGroupDetails(deviceKey, jid), enabled: Boolean(deviceKey && jid), retry: false });
  const invite = useQuery({ queryKey: ["whatsapp-group-invite", deviceKey, jid], queryFn: () => api.getWhatsAppGroupInvite(deviceKey, jid), enabled: Boolean(deviceKey && jid), retry: false });
  const messages = useQuery({ queryKey: ["whatsapp-group-messages", deviceKey, jid], queryFn: () => api.getMessages({ device_key: deviceKey, chat_jid: jid, limit: 100, offset: 0 }), enabled: Boolean(deviceKey && jid), retry: false, refetchInterval: 10_000 });
  const contacts = useQuery({ queryKey: ["group-member-contacts", memberSearch], queryFn: () => api.getContacts({ search: memberSearch || undefined, limit: 100, offset: 0 }), enabled: membersOpen, retry: false });
  const mutation = useMutation({
    mutationFn: (operation: AdminOperation) => runAdminOperation(deviceKey, operation),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", deviceKey] }),
        queryClient.invalidateQueries({ queryKey: ["whatsapp-group-details", deviceKey, jid] }),
        queryClient.invalidateQueries({ queryKey: ["whatsapp-group-invite", deviceKey, jid] }),
      ]);
      toast.success("Perubahan berhasil dikirim ke WhatsApp.");
    },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const recentInbound = messages.data?.data.find((message) => message.direction === "inbound" && messages.dataUpdatedAt >= new Date(message.created_at).getTime() && messages.dataUpdatedAt - new Date(message.created_at).getTime() <= 24 * 60 * 60 * 1000);
  const replyTarget = replyId ? messages.data?.data.find((message) => message.id === replyId && message.direction === "inbound") : recentInbound;
  const send = useMutation({
    mutationFn: () => api.sendMessage({ device_key: deviceKey, to: jid, message: text.trim(), reply_to_message_id: replyTarget!.id }),
    onSuccess: (result) => { toast.success(result.status === "quota_hold" ? "Pesan disimpan menunggu kuota." : "Pesan grup masuk antrean."); setText(""); setReplyId(null); void queryClient.invalidateQueries({ queryKey: ["whatsapp-group-messages", deviceKey, jid] }); },
    onError: (e) => toast.error("Pesan gagal dikirim", { description: apiMessage(e) }),
  });
  const groupMessages = [...(messages.data?.data ?? [])].reverse();

  return <>
    <div className="grid min-h-[680px] overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b p-4"><div><h2 className="font-semibold">Grup</h2><p className="text-xs text-muted-foreground">{groups.length} percakapan</p></div><div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Muat ulang grup" onClick={() => void queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", deviceKey] })}><RefreshCw className="h-4 w-4" /></Button><Button size="icon" aria-label="Buat grup" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /></Button></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading ? <p className="p-5 text-sm text-muted-foreground">Memuat grup…</p> : error ? <p className="p-4 text-sm text-destructive">{apiMessage(error)}</p> : groups.length === 0 ? <div className="p-5 text-center"><p className="text-sm text-muted-foreground">Belum ada grup di device ini.</p><Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Tambah grup</Button></div> : groups.map((group) => <button type="button" key={group.id} onClick={() => { setSelectedId(group.id); setReplyId(null); setProfileOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${jid === group.id ? "bg-primary/10" : "hover:bg-muted/70"}`}>
            <Avatar className="h-12 w-12 shrink-0"><AvatarFallback className="bg-primary/10 font-semibold text-primary">{group.name.slice(0, 1).toLocaleUpperCase("id-ID")}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{group.name}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{group.member_count} anggota</span></span>
          </button>)}
        </div>
      </aside>

      <section className="flex min-h-[620px] min-w-0 flex-col">
        {!selected ? <div className="m-auto max-w-sm p-8 text-center"><MessageCircle className="mx-auto h-10 w-10 text-muted-foreground/60" /><h3 className="mt-3 font-semibold">Pilih grup</h3><p className="mt-1 text-sm text-muted-foreground">Percakapan dan pengaturan grup akan tampil di sini.</p></div> : <>
          <header className="flex items-center justify-between gap-3 border-b p-3 sm:p-4"><button type="button" onClick={() => setProfileOpen(true)} className="flex min-w-0 items-center gap-3 text-left"><Avatar className="h-11 w-11"><AvatarImage src={details.data?.image_url ?? undefined} /><AvatarFallback className="bg-primary/10 font-semibold text-primary">{selected.name.slice(0, 1).toLocaleUpperCase("id-ID")}</AvatarFallback></Avatar><span className="min-w-0"><span className="block truncate font-semibold">{selected.name}</span><span className="block text-xs text-muted-foreground">{selected.member_count} anggota</span></span></button><Button size="icon" variant="ghost" aria-label="Info grup" onClick={() => setProfileOpen(true)}><Settings2 className="h-5 w-5" /></Button></header>

          <>
            <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4 sm:p-6">
              {messages.isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Memuat percakapan…</p> : messages.isError ? <p className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{apiMessage(messages.error)}</p> : groupMessages.length === 0 ? <div className="py-12 text-center"><MessageCircle className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm text-muted-foreground">Belum ada pesan grup yang tersimpan.</p><p className="mt-1 text-xs text-muted-foreground">Pesan baru muncul saat device tersambung. Riwayat lama bergantung pada data yang WhatsApp kirim saat sinkronisasi.</p></div> : groupMessages.map((message) => <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${message.direction === "outbound" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card"}`}><p className="whitespace-pre-wrap break-words text-sm">{message.content || (message.type === "image" ? "📷 Foto" : message.type === "video" ? "🎥 Video" : message.type === "audio" ? "🎙️ Pesan suara" : "Pesan")}</p><div className="mt-1 flex items-center justify-end gap-2"><time className="text-[10px] opacity-70">{new Date(message.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>{message.direction === "inbound" && messages.dataUpdatedAt >= new Date(message.created_at).getTime() && messages.dataUpdatedAt - new Date(message.created_at).getTime() <= 24 * 60 * 60 * 1000 && <button type="button" className="inline-flex items-center gap-1 text-[10px] underline opacity-80" onClick={() => setReplyId(message.id)}><Reply className="h-3 w-3" />Balas</button>}</div></div>
              </div>)}
            </div>
            <form className="border-t p-4" onSubmit={(event) => { event.preventDefault(); if (text.trim() && replyTarget) send.mutate(); }}>
              {replyTarget ? <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2 text-xs"><span className="truncate">Membalas: {replyTarget.content || "pesan media"}</span><button type="button" className="ml-3 text-muted-foreground" onClick={() => setReplyId(null)} aria-label="Batalkan balasan">×</button></div> : <p className="mb-2 text-xs text-muted-foreground">Pilih pesan masuk dalam 24 jam untuk membalas di grup.</p>}
              <div className="flex items-end gap-2"><Textarea rows={2} maxLength={4096} value={text} onChange={(event) => setText(event.target.value)} placeholder="Tulis pesan di grup…" disabled={!replyTarget || send.isPending} /><Button type="submit" size="icon" aria-label="Kirim pesan grup" disabled={!replyTarget || !text.trim() || send.isPending}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div>
            </form>
          </>
        </>}
      </section>
    </div>

    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="max-h-[88vh] max-w-md overflow-y-auto p-0"><DialogHeader className="sr-only"><DialogTitle>Info grup {selected?.name}</DialogTitle><DialogDescription>Pengaturan grup WhatsApp</DialogDescription></DialogHeader>{details.isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Memuat info grup…</p> : details.isError ? <p className="p-8 text-sm text-destructive">{apiMessage(details.error)}</p> : details.data && selected && <div className="space-y-4 p-5">
      <div className="flex flex-col items-center text-center"><div className="relative"><Avatar className="h-24 w-24"><AvatarImage src={details.data.image_url ?? undefined} /><AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">{selected.name.slice(0, 1).toLocaleUpperCase("id-ID")}</AvatarFallback></Avatar><label className="absolute bottom-0 right-0 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border bg-background shadow-sm" title="Ganti foto grup"><Camera className="h-4 w-4" /><input className="sr-only" type="file" accept="image/*" disabled={mutation.isPending} onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; try { mutation.mutate({ kind: "group.picture", jid, image_base64: await resizeImage(file) }); } catch (e) { toast.error(apiMessage(e)); } }} /></label></div><div className="mt-3 flex items-center gap-2"><h3 className="text-lg font-semibold">{details.data.name}</h3><Button size="icon" variant="ghost" aria-label="Edit nama dan deskripsi" onClick={() => setEditInfoOpen(true)}><Pencil className="h-4 w-4" /></Button></div><p className="text-sm text-muted-foreground">Grup · {details.data.participants.length} anggota</p><p className="mt-2 max-w-sm text-sm text-muted-foreground">{details.data.description || "Belum ada deskripsi"}</p></div>
      <div className="grid grid-cols-3 gap-2"><Button variant="outline" className="h-auto flex-col gap-1 py-3" onClick={() => setMembersOpen(true)}><UserPlus className="h-4 w-4" /><span className="text-xs">Anggota</span></Button><Button variant="outline" className="h-auto flex-col gap-1 py-3" disabled={!invite.data?.code} onClick={() => invite.data?.code && void navigator.clipboard.writeText(`https://chat.whatsapp.com/${invite.data.code}`).then(() => toast.success("Tautan disalin."))}><Copy className="h-4 w-4" /><span className="text-xs">Salin tautan</span></Button><Button variant="outline" className="h-auto flex-col gap-1 py-3" onClick={() => mutation.mutate({ kind: "group.invite.revoke", jid })}><Link2 className="h-4 w-4" /><span className="text-xs">Perbarui tautan</span></Button></div>
      <details className="border-t pt-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium"><Settings2 className="h-4 w-4" />Izin grup</summary><div className="mt-3 space-y-3"><div className="flex items-center justify-between gap-3"><Label>Kirim pesan</Label><Select value={String(details.data.announcement_only)} onValueChange={(v) => mutation.mutate({ kind: "group.settings", jid, settings: { announcement_only: v === "true" } })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="false">Semua anggota</SelectItem><SelectItem value="true">Admin saja</SelectItem></SelectContent></Select></div><div className="flex items-center justify-between gap-3"><Label>Edit info</Label><Select value={String(details.data.restricted)} onValueChange={(v) => mutation.mutate({ kind: "group.settings", jid, settings: { restricted: v === "true" } })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="false">Semua anggota</SelectItem><SelectItem value="true">Admin saja</SelectItem></SelectContent></Select></div><div className="flex items-center justify-between gap-3"><Label>Tambah anggota</Label><Select value={details.data.member_add_mode} onValueChange={(v) => mutation.mutate({ kind: "group.settings", jid, settings: { member_add_mode: v as "admin_add" | "all_member_add" } })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_member_add">Semua anggota</SelectItem><SelectItem value="admin_add">Admin saja</SelectItem></SelectContent></Select></div></div></details>
      <details open={membersOpen} onToggle={(event) => setMembersOpen(event.currentTarget.open)} className="border-t pt-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" />Anggota · {details.data.participants.length}</summary><div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{details.data.participants.map((person) => <div key={person.id} className="flex items-center gap-2"><Avatar className="h-8 w-8"><AvatarFallback>{(person.name || person.id).slice(0, 1).toUpperCase()}</AvatarFallback></Avatar><span className="min-w-0 flex-1 truncate text-sm">{person.name || person.id}</span><span className="text-xs text-muted-foreground">{person.role === "owner" ? "Pemilik" : person.role === "admin" ? "Admin" : "Anggota"}</span></div>)}</div>
        <div className="mt-4 space-y-3 border-t pt-3"><Label className="text-xs">Tambah anggota</Label><Input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Cari kontak tersimpan…" />
          <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2">{contacts.isLoading ? <p className="p-2 text-xs text-muted-foreground">Memuat kontak…</p> : (contacts.data?.data ?? []).length === 0 ? <p className="p-2 text-xs text-muted-foreground">Kontak tidak ditemukan.</p> : contacts.data?.data.map((contact) => <label key={contact.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" checked={selectedContacts.includes(contact.id)} onChange={(event) => setSelectedContacts((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} /><span className="min-w-0 flex-1 truncate">{contact.name || contact.phone_number}</span><span className="text-xs text-muted-foreground">{contact.phone_number}</span></label>)}</div>
          <div className="space-y-1"><Label className="text-xs">Atau masukkan nomor</Label><Textarea rows={2} value={memberNumbers} onChange={(event) => setMemberNumbers(event.target.value)} placeholder={"6281234567890\n6289876543210"} /><p className="text-[11px] text-muted-foreground">Pakai kode negara, pisahkan nomor dengan baris baru atau koma.</p></div>
          <Button size="sm" disabled={mutation.isPending || (!selectedContacts.length && !memberNumbers.trim())} onClick={() => { const fromContacts = (contacts.data?.data ?? []).filter((contact) => selectedContacts.includes(contact.id)).map((contact) => contact.phone_number); const manual = memberNumbers.split(/[\\n,;]+/).map((value) => value.trim()).filter(Boolean); const participants = [...new Set([...fromContacts, ...manual].map((phone) => phone.replace(/[^+\\d]/g, "")))]; if (!participants.length) return; mutation.mutate({ kind: "group.members", jid, action: "add", participants }, { onSuccess: () => { setSelectedContacts([]); setMemberNumbers(""); void queryClient.invalidateQueries({ queryKey: ["whatsapp-group-details", deviceKey, jid] }); } }); }}><UserPlus className="mr-2 h-4 w-4" />Tambah pilihan</Button>
        </div>
      </details>
      <Button variant="destructive" className="w-full" onClick={() => { if (window.confirm(`Keluarkan device ini dari grup “${selected.name}”?`)) mutation.mutate({ kind: "group.leave", jid }); }}><LogOut className="mr-2 h-4 w-4" />Keluar dari grup</Button>
    </div>}</DialogContent></Dialog>
    <Dialog open={editInfoOpen} onOpenChange={setEditInfoOpen}><DialogContent><DialogHeader><DialogTitle>Edit info grup</DialogTitle><DialogDescription>Ubah nama dan deskripsi grup.</DialogDescription></DialogHeader>{details.data && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); const description = String(form.get("description") ?? "").trim(); mutation.mutate({ kind: "group.update", jid, ...(name ? { name } : {}), description }, { onSuccess: () => setEditInfoOpen(false) }); }}><div className="space-y-2"><Label>Nama</Label><Input name="name" defaultValue={details.data.name} maxLength={100} /></div><div className="space-y-2"><Label>Deskripsi</Label><Textarea name="description" defaultValue={details.data.description ?? ""} maxLength={512} placeholder="Tambahkan deskripsi grup" /></div><Button type="submit" disabled={mutation.isPending}>Simpan</Button></form>}</DialogContent></Dialog>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Tambah grup</DialogTitle><DialogDescription>Buat grup WhatsApp baru dan tambahkan nomor peserta. Gunakan format internasional, satu nomor per baris.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); if (!name) return; mutation.mutate({ kind: "group.create", name, participants: parseParticipants(form.get("participants")) }, { onSuccess: () => setCreateOpen(false) }); }}><div className="space-y-2"><Label>Nama grup</Label><Input name="name" required maxLength={100} placeholder="Contoh: Tim toko" /></div><div className="space-y-2"><Label>Nomor anggota (opsional)</Label><Textarea name="participants" placeholder={"6281234567890\n6289876543210"} /><p className="text-xs text-muted-foreground">Gunakan angka dan kode negara tanpa tanda +.</p></div><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Membuat grup…" : "Buat grup"}</Button></form></DialogContent></Dialog>
  </>;
}

export default function WhatsAppGroupsPage() {
  const queryClient = useQueryClient();
  const { data: devices = [], isLoading: devicesLoading } = useDevices();
  const onlineDevices = useMemo(() => devices.filter((device) => device.status === "online"), [devices]);
  const [deviceKey, setDeviceKey] = useState("");
  const [section, setSection] = useState<"groups" | "communities" | "channels">("groups");
  const [communityCreateOpen, setCommunityCreateOpen] = useState(false);
  const [communityPendingCommandId, setCommunityPendingCommandId] = useState<string | null>(null);
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [channelFollowOpen, setChannelFollowOpen] = useState(false);
  const activeDevice = deviceKey || onlineDevices[0]?.device_key || "";
  const rememberCommunityCommand = (id: string | null) => setCommunityPendingCommandId(id);
  const groups = useQuery({
    queryKey: ["whatsapp-groups", activeDevice],
    queryFn: () => api.getWhatsAppGroups(activeDevice),
    enabled: Boolean(activeDevice),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const channels = useQuery({
    queryKey: ["whatsapp-channels", activeDevice],
    queryFn: () => api.getWhatsAppChannels(activeDevice),
    enabled: Boolean(activeDevice),
    retry: false,
  });
  const [channelLink, setChannelLink] = useState("");
  const [channel, setChannel] = useState<WhatsAppChannelSummary | null>(null);
  const [postChannelJid, setPostChannelJid] = useState("");
  const channelLookup = useMutation({
    mutationFn: () => api.lookupWhatsAppChannel(activeDevice, channelLink.trim()),
    onSuccess: setChannel,
  });
  const admin = useMutation({
    mutationFn: (operation: AdminOperation) => operation.kind === "community.create"
      ? createCommunityAndWait(activeDevice, { name: operation.name, description: operation.description }, rememberCommunityCommand)
      : runAdminOperation(activeDevice, operation),
    onSuccess: async (_data, operation) => {
      if (operation.kind === "community.create") rememberCommunityCommand(null);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", activeDevice] });
      if (operation.kind === "community.create") setCommunityCreateOpen(false);
      toast.success("Perubahan berhasil dikirim ke WhatsApp.");
    },
    onError: (error, operation) => {
      if (operation.kind === "community.create") {
        const terminal = error instanceof CommunityCommandError && error.terminal;
        if (terminal) {
          rememberCommunityCommand(null);
          void queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", activeDevice] });
        }
        toast.error(apiMessage(error));
        return;
      }
      toast.error(apiMessage(error));
    },
  });
  const checkCommunityCommand = async () => {
    if (!communityPendingCommandId) return;
    try {
      const command = await api.getDeviceCommand(activeDevice, communityPendingCommandId);
      if (command.status === "queued" || command.status === "running") {
        toast.info("Perintah masih diproses WhatsApp. Jangan kirim ulang dulu.");
        return;
      }
      rememberCommunityCommand(null);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", activeDevice] });
      if (command.status === "done" && command.result != null) toast.success("Perintah selesai. Daftar komunitas diperbarui.");
      else toast.error(command.error?.replace(/^[A-Z_]+:\s*/, "") ?? "WhatsApp tidak mengonfirmasi pembuatan komunitas. Periksa daftar sebelum mencoba lagi.");
    } catch (error) {
      toast.error(apiMessage(error));
    }
  };
  const channelAdmin = useMutation({
    mutationFn: (operation: ChannelOperation) => {
      if (operation.kind === "follow") return api.followWhatsAppChannel(activeDevice, operation.link);
      if (operation.kind === "create") return api.createWhatsAppChannel(activeDevice, { name: operation.name, description: operation.description });
      if (operation.kind === "post") return api.postWhatsAppChannel(activeDevice, operation.jid, operation.payload);
      if (operation.kind === "update") return api.updateWhatsAppChannel(activeDevice, operation.jid, { name: operation.name, description: operation.description });
      return api.unfollowWhatsAppChannel(activeDevice, operation.jid);
    },
    onSuccess: async (_data, operation) => {
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-channels", activeDevice] });
      if (operation.kind === "create") setChannelCreateOpen(false);
      if (operation.kind === "follow") setChannelFollowOpen(false);
      toast.success(operation.kind === "post" ? "Posting berhasil dikirim ke saluran." : operation.kind === "create" ? "Saluran berhasil dibuat." : operation.kind === "follow" ? "Berhasil mengikuti saluran." : "Saluran berhasil diperbarui.");
    },
    onError: (error, operation) => {
      if (operation.kind === "create") {
        void queryClient.invalidateQueries({ queryKey: ["whatsapp-channels", activeDevice] });
        toast.error("WhatsApp mungkin sudah membuat salurannya, tetapi KONEVA belum menerima konfirmasi. Daftar sedang dimuat ulang; cek dulu sebelum mencoba membuat lagi.");
      } else toast.error(apiMessage(error));
    },
  });

  const communities = (groups.data ?? []).filter((group) => group.is_community);
  const regularGroups = (groups.data ?? []).filter((group) => !group.is_community);
  const ownedChannels = (channels.data ?? []).filter((item) => item.is_owner);
  const postChannel = ownedChannels.find((item) => item.id === postChannelJid) ?? ownedChannels[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display">Grup, komunitas & saluran</h1>
          <p className="text-muted-foreground">Kelola grup dan komunitas, lalu terbitkan informasi untuk pengikut saluran WhatsApp milikmu.</p>
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

      <div className="grid gap-2 rounded-xl border bg-card p-2 sm:grid-cols-3" role="tablist" aria-label="Jenis percakapan WhatsApp">
        {([
          { id: "groups", label: "Grup", icon: Users, count: regularGroups.length },
          { id: "communities", label: "Komunitas", icon: MessagesSquare, count: communities.length },
          { id: "channels", label: "Saluran", icon: Megaphone, count: channels.data?.length ?? 0 },
        ] as const).map(({ id, label, icon: Icon, count }) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}
            className={`flex min-h-12 items-center justify-between rounded-lg px-4 text-sm font-medium transition-colors ${section === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <span className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</span><span className={`rounded-full px-2 py-0.5 text-xs ${section === id ? "bg-primary-foreground/15" : "bg-muted"}`}>{count}</span>
          </button>
        ))}
      </div>

      {section === "groups" && <GroupWorkspace deviceKey={activeDevice} groups={regularGroups} isLoading={groups.isLoading} error={groups.error} />}

      {section === "communities" && <>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div><CardTitle>Komunitas WhatsApp</CardTitle><p className="mt-1 text-sm text-muted-foreground">Kelompokkan beberapa grup dalam satu ruang; tautkan atau lepas grup dari pengaturannya.</p></div>
            <Button className="shrink-0" onClick={() => setCommunityCreateOpen(true)} disabled={!activeDevice || admin.isPending}><Plus className="mr-2 h-4 w-4" />Tambah komunitas</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.isLoading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Mengambil komunitas…</div>
              : groups.isError ? <p className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{apiMessage(groups.error)}</p>
                : communities.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Belum ada komunitas di device ini. Pilih “Tambah komunitas” untuk membuatnya.</p>
                  : communities.map((community) => {
                    const children = regularGroups.filter((group) => group.parent_community_jid === community.id);
                    return <div key={community.id} className="rounded-xl border bg-background p-4 shadow-sm"><div className="flex items-start gap-3"><MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-semibold">{community.name}</p><p className="mt-1 text-xs text-muted-foreground">{community.member_count} anggota · {children.length} grup tertaut</p>{community.description && <p className="mt-2 text-sm text-muted-foreground">{community.description}</p>}<p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{community.id}</p></div></div>
                      {children.length > 0 && <ul className="ml-7 mt-3 space-y-1 text-sm text-muted-foreground">{children.map((group) => <li key={group.id}>• {group.name}</li>)}</ul>}
                      <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Pengaturan komunitas</summary><div className="mt-3 space-y-4">
                        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); const description = String(form.get("description") ?? "").trim(); admin.mutate({ kind: "community.update", jid: community.id, ...(name ? { name } : {}), description }); }}><Label>Nama dan deskripsi</Label><Input name="name" defaultValue={community.name} maxLength={100} disabled={admin.isPending} /><Textarea name="description" defaultValue={community.description ?? ""} maxLength={512} placeholder="Deskripsi komunitas" disabled={admin.isPending} /><Button size="sm" type="submit" disabled={admin.isPending}>Simpan info</Button></form>
                        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const groupJid = String(form.get("group_jid") ?? ""); const action = String(form.get("action")) as "link" | "unlink"; if (groupJid) admin.mutate({ kind: "community.link", jid: community.id, group_jid: groupJid, action }); }}><div className="min-w-0 flex-1 space-y-2"><Label>Tautkan atau lepas grup</Label><Select name="group_jid"><SelectTrigger><SelectValue placeholder="Pilih grup" /></SelectTrigger><SelectContent>{regularGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></div><Select name="action" defaultValue="link"><SelectTrigger className="sm:w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="link">Tautkan</SelectItem><SelectItem value="unlink">Lepas</SelectItem></SelectContent></Select><Button size="sm" type="submit" variant="outline" disabled={admin.isPending}>Terapkan</Button></form>
                        <Button size="sm" variant="destructive" disabled={admin.isPending} onClick={() => { if (window.confirm(`Keluarkan nomor terhubung ini dari komunitas “${community.name}”? Komunitas tidak dihapus untuk anggota lain.`)) admin.mutate({ kind: "community.leave", jid: community.id }); }}>Keluar dari komunitas</Button>
                      </div></details>
                    </div>;
                  })}
          </CardContent>
        </Card>
        <Dialog open={communityCreateOpen} onOpenChange={setCommunityCreateOpen}><DialogContent><DialogHeader><DialogTitle>Tambah komunitas</DialogTitle><DialogDescription>Buat ruang untuk mengelompokkan grup WhatsApp. Setelah dibuat, tautkan grup dari pengaturan komunitas.</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); if (name) admin.mutate({ kind: "community.create", name, description: String(form.get("description") ?? "").trim() }); }}>
            <div className="space-y-2"><Label>Nama komunitas</Label><Input name="name" required maxLength={100} placeholder="Contoh: Pelanggan toko" disabled={!activeDevice || admin.isPending || Boolean(communityPendingCommandId)} /></div><div className="space-y-2"><Label>Deskripsi (opsional)</Label><Textarea name="description" maxLength={512} placeholder="Tentang komunitas ini" disabled={!activeDevice || admin.isPending || Boolean(communityPendingCommandId)} /></div><Button type="submit" disabled={!activeDevice || admin.isPending || Boolean(communityPendingCommandId)}>{admin.isPending ? "Menunggu jawaban WhatsApp…" : communityPendingCommandId ? "Periksa hasil dulu" : "Buat komunitas"}</Button>
            {communityPendingCommandId && <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><p>Hasil perintah sebelumnya belum dipastikan. Jangan buat komunitas lagi dulu.</p><Button className="mt-2" size="sm" type="button" variant="outline" onClick={() => void checkCommunityCommand()}>Periksa status</Button></div>}
          </form>
        </DialogContent></Dialog>
      </>}

      {section === "channels" && <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle>Saluran WhatsApp</CardTitle><p className="mt-1 text-sm text-muted-foreground">Pilih saluran untuk melihat info dan menulis postingan.</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" onClick={() => setChannelFollowOpen(true)} disabled={!activeDevice || channelAdmin.isPending}><Link2 className="mr-2 h-4 w-4" />Ikuti saluran</Button><Button onClick={() => setChannelCreateOpen(true)} disabled={!activeDevice || channelAdmin.isPending}><Plus className="mr-2 h-4 w-4" />Tambah saluran</Button></div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            {channels.isLoading ? <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat daftar saluran…</div>
              : channels.isError ? <p className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{apiMessage(channels.error)}</p>
                : channels.data?.length ? channels.data.map((item) => <div key={item.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{item.name} {item.is_owner && <span className="ml-1 text-xs text-primary">· Saluran Anda</span>}</p><p className="text-xs text-muted-foreground">{item.description || "Tanpa deskripsi"} · {item.subscribers == null ? "pengikut tidak diketahui" : `${item.subscribers.toLocaleString("id-ID")} pengikut`}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.id}</p>{item.invite && <a className="mt-1 inline-block text-xs text-primary underline" href={`https://whatsapp.com/channel/${item.invite}`} target="_blank" rel="noreferrer">Buka tautan undangan</a>}</div><Button size="sm" variant="outline" disabled={channelAdmin.isPending} onClick={() => { if (window.confirm(`Berhenti mengikuti “${item.name}”?`)) channelAdmin.mutate({ kind: "unfollow", jid: item.id }); }}>Berhenti ikuti</Button></div>
                  {item.is_owner ? <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Ubah info saluran</summary><form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); const description = String(form.get("description") ?? "").trim(); channelAdmin.mutate({ kind: "update", jid: item.id, ...(name ? { name } : {}), description }); }}><Label>Nama dan deskripsi</Label><Input name="name" defaultValue={item.name} maxLength={100} disabled={channelAdmin.isPending} /><Textarea name="description" defaultValue={item.description ?? ""} maxLength={512} disabled={channelAdmin.isPending} /><Button size="sm" type="submit" disabled={channelAdmin.isPending}>Simpan info</Button></form></details> : <Button size="sm" variant="outline" disabled={channelAdmin.isPending} onClick={() => { if (window.confirm(`Berhenti mengikuti “${item.name}”?`)) channelAdmin.mutate({ kind: "unfollow", jid: item.id }); }}>Berhenti ikuti</Button>}
                </div>) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada saluran yang diikuti atau dibuat lewat KONEVA.</p>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={channelCreateOpen} onOpenChange={setChannelCreateOpen}><DialogContent><DialogHeader><DialogTitle>Tambah saluran</DialogTitle><DialogDescription>Buat saluran baru dari device WhatsApp yang dipilih.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); if (!name) return; channelAdmin.mutate({ kind: "create", name, description: String(form.get("description") ?? "").trim() }); }}>
          <div className="space-y-2"><Label>Nama saluran</Label><Input name="name" required maxLength={100} placeholder="Contoh: Info Toko Mas" disabled={!activeDevice || channelAdmin.isPending} /></div><div className="space-y-2"><Label>Deskripsi (opsional)</Label><Textarea name="description" maxLength={512} placeholder="Informasi saluran" disabled={!activeDevice || channelAdmin.isPending} /></div><Button type="submit" disabled={!activeDevice || channelAdmin.isPending}>{channelAdmin.isPending ? "Membuat saluran…" : "Buat saluran"}</Button>
        </form>
      </DialogContent></Dialog>
      <Dialog open={channelFollowOpen} onOpenChange={setChannelFollowOpen}><DialogContent><DialogHeader><DialogTitle>Ikuti saluran</DialogTitle><DialogDescription>Masukkan tautan undangan saluran WhatsApp.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const link = String(form.get("link") ?? "").trim(); if (link) channelAdmin.mutate({ kind: "follow", link }); }}>
          <div className="space-y-2"><Label>Tautan undangan</Label><Input name="link" type="url" required placeholder="https://whatsapp.com/channel/..." disabled={!activeDevice || channelAdmin.isPending} /></div><Button type="submit" disabled={!activeDevice || channelAdmin.isPending}>{channelAdmin.isPending ? "Mengikuti…" : "Ikuti saluran"}</Button>
        </form>
      </DialogContent></Dialog>

      <Card>
        <CardHeader><CardTitle>Posting informasi ke saluran</CardTitle><p className="text-sm text-muted-foreground">Kirim pengumuman teks, foto, atau video ke pengikut saluran milikmu. Polling dan reaksi belum tersedia di koneksi WhatsApp yang dipakai, jadi kontrolnya tidak ditampilkan.</p></CardHeader>
        <CardContent>
          {!ownedChannels.length ? <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Belum ada saluran milik device ini. Buat saluran terlebih dahulu pada bagian Saluran WhatsApp.</p> : <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => {
            event.preventDefault();
            if (!postChannel) return;
            const form = new FormData(event.currentTarget);
            const kind = String(form.get("kind")) as "text" | "image" | "video";
            const text = String(form.get("text") ?? "").trim();
            const media_url = String(form.get("media_url") ?? "").trim();
            const caption = String(form.get("caption") ?? "").trim();
            if (kind === "text" && !text) { toast.error("Tulis informasi yang akan diposting."); return; }
            if (kind !== "text" && !media_url) { toast.error("Masukkan tautan HTTPS foto atau video."); return; }
            channelAdmin.mutate({ kind: "post", jid: postChannel.id, payload: { kind, ...(text ? { text } : {}), ...(media_url ? { media_url } : {}), ...(caption ? { caption } : {}) } });
          }}>
            <div className="space-y-2 md:col-span-2"><Label>Saluran</Label><Select value={postChannel?.id} onValueChange={setPostChannelJid}><SelectTrigger><SelectValue placeholder="Pilih saluran milikmu" /></SelectTrigger><SelectContent>{ownedChannels.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2 md:col-span-2"><Label>Jenis postingan</Label><Select name="kind" defaultValue="text"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Teks pengumuman</SelectItem><SelectItem value="image">Foto</SelectItem><SelectItem value="video">Video</SelectItem></SelectContent></Select></div>
            <div className="space-y-2 md:col-span-2"><Label>Informasi</Label><Textarea name="text" maxLength={4096} placeholder="Tulis informasi untuk pengikut saluran…" disabled={channelAdmin.isPending} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Tautan foto atau video</Label><Input name="media_url" type="url" placeholder="https://… (kosongkan untuk posting teks)" disabled={channelAdmin.isPending} /><p className="text-xs text-muted-foreground">Untuk foto/video, isi tautan HTTPS yang bisa diakses tanpa login dan pilih jenis media yang sesuai.</p></div>
            <div className="space-y-2 md:col-span-2"><Label>Keterangan media (opsional)</Label><Input name="caption" maxLength={1024} placeholder="Tambahkan keterangan foto/video" disabled={channelAdmin.isPending} /></div>
            <Button type="submit" disabled={!activeDevice || !postChannel || channelAdmin.isPending} className="md:col-span-2">{channelAdmin.isPending ? "Mengirim postingan…" : "Posting ke saluran"}</Button>
          </form>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Periksa saluran WhatsApp</CardTitle><p className="text-sm text-muted-foreground">Masukkan tautan undangan saluran untuk melihat nama, deskripsi, dan jumlah pengikut yang tersedia.</p></CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setChannel(null); channelLookup.mutate(); }}>
            <Input aria-label="Tautan saluran" value={channelLink} onChange={(event) => setChannelLink(event.target.value)} placeholder="https://whatsapp.com/channel/..." disabled={!activeDevice || channelLookup.isPending} />
            <Button type="submit" disabled={!activeDevice || !channelLink.trim() || channelLookup.isPending} className="shrink-0">{channelLookup.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memeriksa…</> : <><Radio className="mr-2 h-4 w-4" />Periksa saluran</>}</Button>
          </form>
          {channelLookup.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{apiMessage(channelLookup.error)}</p>}
          {channel && <div className="rounded-xl border p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div className="min-w-0"><p className="font-medium">{channel.name}</p><p className="text-xs text-muted-foreground">{channel.subscribers == null ? "Jumlah pengikut tidak tersedia" : `${channel.subscribers.toLocaleString("id-ID")} pengikut`} · {channel.verification === "VERIFIED" ? "Terverifikasi" : "Belum terverifikasi"}</p>{channel.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{channel.description}</p>}<p className="mt-2 break-all font-mono text-xs text-muted-foreground">{channel.id}</p></div></div></div>}
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />WhatsApp tidak menyediakan daftar semua saluran yang diikuti untuk disinkronkan. Saluran yang kamu ikuti atau buat lewat KONEVA akan tersimpan di daftar di atas.</p>
        </CardContent>
      </Card>
      </>}
    </div>
  );
}
