"use client";

import { useMemo, useState } from "react";
import { Clock, ImageIcon, Loader2, Type, Video } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DeviceSelect } from "@/components/devices/device-select";
import { useDevices } from "@/hooks/use-devices";
import { useCancelCommand, usePostStatus, useStatusPosts } from "@/hooks/use-business";
import { usePermissions } from "@/hooks/use-me";
import { businessErrorText, commandErrorText } from "@/lib/business-errors";
import type { CommandStatus, StatusPost } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const KINDS = [
  { id: "text", label: "Teks", icon: Type },
  { id: "image", label: "Gambar", icon: ImageIcon },
  { id: "video", label: "Video", icon: Video },
] as const;
const COLORS = ["#1d4ed8", "#0f766e", "#b45309", "#9d174d", "#334155", "#6d28d9"];
const STATE: Record<CommandStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Menunggu", variant: "secondary" }, running: { label: "Diproses", variant: "secondary" },
  done: { label: "Terposting", variant: "default" }, failed: { label: "Gagal", variant: "destructive" }, cancelled: { label: "Dibatalkan", variant: "outline" },
};

export default function StatusPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data: devices, isLoading } = useDevices();
  const [chosen, setChosen] = useState<string>();
  const online = useMemo(() => (devices ?? []).filter((d) => d.status === "online"), [devices]);
  const deviceKey = chosen ?? online[0]?.device_key;
  const posts = useStatusPosts(deviceKey);
  const post = usePostStatus(deviceKey ?? "");
  const cancel = useCancelCommand(deviceKey ?? "");

  const [kind, setKind] = useState<StatusPost["kind"]>("text");
  const [text, setText] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<"chatted" | "list">("chatted");
  const [numbers, setNumbers] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!permsLoading && !can("devices:read")) return <p className="text-muted-foreground">Peran Anda tidak bisa membuka halaman ini.</p>;
  const canPost = can("content:write");
  const list = numbers.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean);
  const valid = (kind === "text" ? text.trim().length > 0 : /^https:\/\//i.test(mediaUrl.trim())) && (audience === "chatted" || list.length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: StatusPost = {
      kind, audience,
      ...(kind === "text" ? { text: text.trim(), background: color } : { media_url: mediaUrl.trim(), ...(caption.trim() ? { caption: caption.trim() } : {}) }),
      ...(audience === "list" ? { numbers: list } : {}),
      ...(sendAt ? { send_at: new Date(sendAt).toISOString() } : {}),
    };
    post.mutate(body, {
      onSuccess: () => { toast.success(sendAt ? "Status dijadwalkan" : "Status masuk antrean"); setText(""); setMediaUrl(""); setCaption(""); setSendAt(""); },
      onError: (err) => setError(businessErrorText(err)),
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-display">Status WhatsApp</h1>
        <p className="mt-2 text-muted-foreground">Posting status dari nomor Anda. Status hanya dilihat kontak yang sudah pernah berbalas pesan dengan nomor ini, dan diposting dalam jam aktif nomor agar terlihat wajar.</p>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : online.length === 0 ? (
        <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Belum ada nomor yang online. Sambungkan nomor dulu di menu Nomor.</p>
      ) : (
        <>
          <DeviceSelect devices={devices ?? []} value={deviceKey} onChange={setChosen} />
          {canPost ? (
            <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-5">
              <div role="tablist" aria-label="Jenis status" className="inline-flex rounded-lg border bg-muted p-1">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} onClick={() => setKind(k.id)}
                    className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", kind === k.id ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    <k.icon className="h-4 w-4" />{k.label}
                  </button>
                ))}
              </div>

              {kind === "text" ? (
                <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
                  <div className="space-y-2">
                    <Label htmlFor="st-text">Isi status</Label>
                    <Textarea id="st-text" value={text} maxLength={700} rows={5} onChange={(e) => setText(e.target.value)} placeholder="Promo akhir pekan, diskon 20%…" />
                    <p className="text-xs text-muted-foreground">{text.length}/700</p>
                    <div className="flex gap-2" role="radiogroup" aria-label="Warna latar">
                      {COLORS.map((c) => (
                        <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Warna ${c}`} onClick={() => setColor(c)}
                          className={cn("h-7 w-7 rounded-full border-2", color === c ? "border-foreground" : "border-transparent")} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                  <div aria-hidden className="flex aspect-[9/14] items-center justify-center rounded-xl p-4 text-center text-lg font-medium text-white" style={{ backgroundColor: color }}>
                    {text || "Pratinjau"}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="st-media">Alamat {kind === "image" ? "gambar" : "video"} (https)</Label>
                    <Input id="st-media" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://situs-anda.com/promo.jpg" inputMode="url" />
                    <p className="text-xs text-muted-foreground">Tautan langsung ke berkas yang bisa dibuka publik. Alamat lokal ditolak.</p>
                  </div>
                  <div className="space-y-2"><Label htmlFor="st-cap">Keterangan (opsional)</Label><Input id="st-cap" value={caption} maxLength={700} onChange={(e) => setCaption(e.target.value)} /></div>
                </div>
              )}

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Siapa yang melihat</legend>
                {([["chatted", "Kontak yang pernah berbalas pesan (disarankan)"], ["list", "Daftar nomor tertentu"]] as const).map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2 text-sm"><input type="radio" name="aud" checked={audience === id} onChange={() => setAudience(id)} className="accent-[var(--primary)]" />{label}</label>
                ))}
                {audience === "list" && <Textarea aria-label="Daftar nomor" value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={3} placeholder="6281234567890, 6281298765432" />}
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="st-at" className="flex items-center gap-1.5"><Clock className="h-4 w-4" />Jadwalkan (opsional)</Label>
                <Input id="st-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className="w-64" />
                <p className="text-xs text-muted-foreground">Kosongkan untuk posting segera. Di luar jam aktif nomor, status menunggu sampai nomor &quot;bangun&quot;. Maksimal 3 status per nomor per hari.</p>
              </div>

              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={!valid || post.isPending || !deviceKey}>{post.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{sendAt ? "Jadwalkan" : "Posting ke Status"}</Button>
            </form>
          ) : <p className="text-sm text-muted-foreground">Peran Anda hanya bisa melihat riwayat status.</p>}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Riwayat</h2>
            {posts.isLoading ? <Skeleton className="h-24" /> : (posts.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Belum ada status.</p> : (
              <ul className="divide-y rounded-xl border bg-card">
                {posts.data!.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Badge variant={STATE[c.status].variant}>{STATE[c.status].label}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.payload.kind === "text" ? c.payload.text : `${c.payload.kind === "image" ? "Gambar" : "Video"}: ${c.payload.media_url}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(c.run_at).getTime() - new Date(c.created_at).getTime() > 60_000 && c.status === "queued" ? `Dijadwalkan ${formatDate(c.run_at)}` : formatDate(c.created_at)}
                        {c.status === "done" && c.result?.recipients ? ` · dilihat ${c.result.recipients} kontak` : ""}
                        {c.status === "failed" ? ` · ${commandErrorText(c.error)}` : ""}
                      </p>
                    </div>
                    {c.status === "queued" && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(c.id)} disabled={cancel.isPending}>Batalkan</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
