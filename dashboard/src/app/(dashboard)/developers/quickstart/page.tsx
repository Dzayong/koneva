"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CreateKeyDialog } from "@/components/developers/create-key-dialog";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { useDevices } from "@/hooks/use-devices";
import { usePermissions } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { apiFailure, sendRejectionGuidance } from "@/lib/errors";
import { messageErrorText } from "@/lib/message-errors";
import type { CreatedApiKey, MessageStatus } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Lang = "curl" | "node" | "python";
const LANGS: Array<{ id: Lang; label: string }> = [{ id: "curl", label: "cURL" }, { id: "node", label: "Node.js" }, { id: "python", label: "Python" }];

function snippet(lang: Lang, v: { base: string; key: string; device: string; to: string; message: string }): string {
  const body = { device_key: v.device, to: v.to, message: v.message };
  if (lang === "curl") {
    return `curl -X POST ${v.base}/api/v1/message/send \\\n  -H "Authorization: Bearer ${v.key}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`;
  }
  if (lang === "node") {
    return `const res = await fetch("${v.base}/api/v1/message/send", {\n  method: "POST",\n  headers: {\n    Authorization: "Bearer ${v.key}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(${JSON.stringify(body, null, 4).replace(/\n/g, "\n  ")}),\n});\nconsole.log(await res.json());`;
  }
  return `import requests\n\nres = requests.post(\n    "${v.base}/api/v1/message/send",\n    headers={"Authorization": "Bearer ${v.key}"},\n    json=${JSON.stringify(body, null, 4).replace(/\n/g, "\n    ")},\n)\nprint(res.json())`;
}

const STEPS: Array<{ status: MessageStatus[]; label: string }> = [
  { status: ["queued", "sending"], label: "Masuk antrean" },
  { status: ["sent"], label: "Terkirim ke WhatsApp" },
  { status: ["delivered"], label: "Sampai di HP penerima" },
  { status: ["read"], label: "Dibaca" },
];
const RANK: Partial<Record<MessageStatus, number>> = { queued: 0, sending: 0, sent: 1, delivered: 2, read: 3 };

function Result({ id }: { id: string }) {
  const { data: message } = useQuery({
    queryKey: ["message", id],
    queryFn: () => api.getMessage(id),
    refetchInterval: (q) => (["read", "failed", "blocked"].includes(q.state.data?.status ?? "") ? false : 2000),
  });
  if (!message) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memeriksa status…</p>;

  const failed = message.status === "failed" || message.status === "blocked";
  const rank = RANK[message.status] ?? 0;
  const reason = messageErrorText(message.error_message);

  return (
    <div className="space-y-3" aria-live="polite">
      <ol className="space-y-2">
        {STEPS.map((step, i) => {
          const reached = !failed && rank >= i;
          const current = !failed && rank === i;
          return (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[11px] transition-colors", reached ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {reached && !current ? <Check className="h-3 w-3" /> : current && message.status !== "read" ? <Loader2 className="h-3 w-3 animate-spin" /> : reached ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={reached ? "font-medium" : "text-muted-foreground"}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {failed && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Pesan gagal. {reason ?? "Coba lagi nanti."}</p>}
      {!failed && message.status === "queued" && reason && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">Ditunda. {reason}</p>
      )}
      {!failed && message.status === "queued" && !reason && (
        <p className="text-sm text-muted-foreground">Nomor mengirim dengan jeda seperti orang sungguhan, jadi bisa butuh beberapa detik sampai satu menit. Pesan yang butuh cepat, misalnya OTP, dikirim dengan <code>priority: &quot;urgent&quot;</code>.</p>
      )}
      <p className="text-xs text-muted-foreground">Dibuat {formatDate(message.created_at)}</p>
    </div>
  );
}

export default function QuickstartPage() {
  const { can } = usePermissions();
  const { data: devices } = useDevices();
  const online = useMemo(() => (devices ?? []).filter((d) => d.status === "online"), [devices]);
  const [deviceKey, setDeviceKey] = useState<string>("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("Halo! Ini pesan pertama dari KONEVA.");
  const [lang, setLang] = useState<Lang>("curl");
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selected = deviceKey || online[0]?.device_key || "";
  const digits = to.replace(/\D/g, "");
  const validTo = digits.length >= 8 && digits.length <= 15;

  const send = useMutation({
    mutationFn: () => api.sendMessage({ device_key: selected, to: digits, message: text }),
    onError: (error) => {
      const failure = apiFailure(error);
      const guidance = sendRejectionGuidance(failure.code);
      toast.error(guidance?.title ?? "Gagal mengirim", { description: guidance?.description ?? failure.message });
    },
  });

  const code = snippet(lang, {
    base: typeof window === "undefined" ? "" : window.location.origin,
    key: created?.key ?? "wgk_ISI_DENGAN_KUNCI_ANDA",
    device: selected || "KODE_NOMOR_ANDA",
    to: digits || "6281234567890",
    message: text,
  });

  const copy = async () => {
    const ok = await copyText(code);
    setCopied(ok);
    if (!ok) toast.error("Tidak bisa menyalin otomatis", { description: "Pilih kodenya lalu salin manual." });
    else setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h2 className="text-display">Mulai cepat</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Kirim satu pesan dari sini untuk memastikan semuanya bekerja, lalu salin kodenya ke sistem Anda.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="langkah-kirim" className="space-y-4 rounded-lg border bg-card p-5">
          <h3 id="langkah-kirim" className="text-heading text-lg">1. Kirim pesan tes</h3>
          <div className="space-y-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Device baru? Urutan yang benar:</p>
            <p>1. Pindai QR di halaman Device sampai statusnya <strong>online</strong>.</p>
            <p>2. Untuk uji nyata, gunakan nomor Anda sendiri atau penerima yang secara eksplisit menyetujui uji tersebut.</p>
            <p>3. Catat persetujuan dan hormati opt-out sebelum menggunakan fitur pengiriman.</p>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <strong>Perhatian:</strong> tombol di bawah mengirim pesan WhatsApp sungguhan ke nomor yang Anda tulis. Bukan simulasi.
          </div>
          {online.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada device yang online. <Link href="/devices" className="font-medium text-primary underline underline-offset-4">Sambungkan device</Link> dulu, lalu kembali ke sini.
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (validTo) setConfirmOpen(true); }} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="qs-device">Kirim dari device</Label>
                <Select value={selected} onValueChange={setDeviceKey}>
                  <SelectTrigger id="qs-device" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{online.map((d) => <SelectItem key={d.device_key} value={d.device_key}>{d.label || d.device_key}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qs-to">Nomor tujuan</Label>
                <Input id="qs-to" inputMode="tel" placeholder="6281234567890" value={to} onChange={(e) => setTo(e.target.value)} aria-describedby="qs-to-hint" />
                <p id="qs-to-hint" className="text-xs text-muted-foreground">Pakai kode negara tanpa +. Untuk tes pertama, kirim ke nomor Anda sendiri.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qs-text">Pesan</Label>
                <Textarea id="qs-text" rows={3} maxLength={4096} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <Button type="submit" disabled={!can("messages:send") || !validTo || !text.trim() || send.isPending}>
                {send.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Mengirim…</> : <><Send className="mr-2 h-4 w-4" />Tinjau dan kirim</>}
              </Button>
              {!can("messages:send") && (
                <p className="text-xs text-destructive">Peran Anda tidak punya izin mengirim pesan (<code>messages:send</code>). Minta Owner workspace ini.</p>
              )}
            </form>
          )}
          {send.data && <div className="border-t pt-4"><Result id={send.data.message_id} /></div>}
        </section>

        <section aria-labelledby="langkah-kode" className="space-y-4 rounded-lg border bg-card p-5">
          <h3 id="langkah-kode" className="text-heading text-lg">2. Salin kode</h3>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Bahasa" className="inline-flex rounded-lg border p-0.5">
              {LANGS.map((l) => (
                <button key={l.id} role="tab" aria-selected={lang === l.id} onClick={() => setLang(l.id)}
                  className={cn("rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", lang === l.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l.label}</button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={copy}>{copied ? <><Check className="mr-2 h-4 w-4" />Tersalin</> : <><Copy className="mr-2 h-4 w-4" />Salin kode</>}</Button>
          </div>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed"><code>{code}</code></pre>
          {can("keys:manage") ? (
            <div className="rounded-md border p-3 text-sm">
              {created ? (
                <p className="text-muted-foreground"><KeyRound className="mr-1.5 inline h-4 w-4" />Kunci <strong className="text-foreground">{created.name}</strong> sudah dimasukkan ke kode di atas. Kunci ini hanya ada di halaman ini; simpan di tempat aman.</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground">Kode butuh kunci API. Buat kunci yang hanya boleh mengirim pesan.</p>
                  <Button size="sm" onClick={() => setCreateOpen(true)}><KeyRound className="mr-2 h-4 w-4" />Buat kunci kirim</Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Minta owner atau admin membuatkan kunci API untuk Anda.</p>
          )}
          <p className="text-xs text-muted-foreground">Untuk OTP, tambahkan <code>&quot;priority&quot;: &quot;urgent&quot;</code> pada isi permintaan supaya pesan dikirim tanpa jeda.</p>
        </section>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi kirim pesan WhatsApp sungguhan</DialogTitle>
            <DialogDescription>Periksa sekali lagi — ini mengirim pesan nyata, bukan simulasi, dan tidak bisa dibatalkan setelah terkirim.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Device</dt><dd>{selected}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Ke</dt><dd>{digits}</dd></div>
            <dt className="text-muted-foreground">Pesan</dt>
            <dd className="rounded-md border bg-muted/40 p-2 whitespace-pre-wrap">{text}</dd>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={send.isPending}>Batal</Button>
            <Button onClick={() => { setConfirmOpen(false); send.mutate(); }} disabled={send.isPending}>
              {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Ya, kirim sekarang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} initialPreset="send" initialName="Kirim pesan" onCreated={(key) => { setCreated(key); setRevealed(true); }} />
      {created && revealed && (
        <SecretReveal open title="Kunci kirim dibuat" description="Kunci ini sudah dimasukkan ke contoh kode." secret={created.key} onDone={() => setRevealed(false)} />
      )}
    </div>
  );
}
