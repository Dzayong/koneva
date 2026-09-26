"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CodeBlock } from "@/components/developers/code-block";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { EVENTS, EXAMPLE_PAYLOADS, VERIFY_SNIPPETS } from "@/components/developers/webhook-snippets";
import { usePermissions } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";
import type { WebhookTestResult } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold">{title}</h2>{hint && <p className="text-sm text-muted-foreground">{hint}</p>}</div>
      {children}
    </section>
  );
}

export default function WebhooksPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const qc = useQueryClient();
  const allowed = can("webhooks:manage");
  const settings = useQuery({ queryKey: ["webhook"], queryFn: () => api.getWebhook(), enabled: allowed, retry: false });
  const logs = useQuery({ queryKey: ["webhook", "logs"], queryFn: () => api.getWebhookLogs(), enabled: allowed, refetchInterval: 15_000, retry: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [test, setTest] = useState<WebhookTestResult | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const url = draft ?? settings.data?.url ?? "";
  const validUrl = url === "" || /^https?:\/\/.+/i.test(url.trim());

  const save = useMutation({
    mutationFn: (v: string) => api.updateWebhookUrl(v),
    onSuccess: () => { setDraft(null); setTest(null); qc.invalidateQueries({ queryKey: ["webhook"] }); qc.invalidateQueries({ queryKey: ["tenant", "me"] }); toast.success("Alamat webhook disimpan"); },
    onError: (e) => toast.error("Gagal menyimpan", { description: apiFailure(e).message }),
  });
  const runTest = useMutation({
    mutationFn: () => api.testWebhook(),
    onSuccess: (r) => { setTest(r); qc.invalidateQueries({ queryKey: ["webhook", "logs"] }); },
    onError: (e) => toast.error("Tes gagal dijalankan", { description: apiFailure(e).message }),
  });
  const rotate = useMutation({
    mutationFn: () => api.rotateWebhookSecret(),
    onSuccess: (s) => { setSecret(s); setConfirmRotate(false); qc.invalidateQueries({ queryKey: ["webhook"] }); },
    onError: (e) => toast.error("Gagal membuat kunci", { description: apiFailure(e).message }),
  });

  if (!permsLoading && !allowed) return <p className="text-muted-foreground">Peran Anda tidak bisa mengelola webhook.</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhook</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Webhook adalah cara kami <strong>menelepon balik server Anda</strong> saat ada kejadian: pesan terkirim, dibaca, ada balasan, atau nomor bermasalah.
          Anda tidak perlu terus-menerus menanyakan status ke API.
        </p>
      </div>

      <Section title="1. Alamat penerima" hint="Alamat HTTPS di server Anda yang menerima kabar dari kami. Tidak bisa berupa alamat lokal atau jaringan internal.">
        {settings.isLoading ? <Skeleton className="h-10" /> : (
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (validUrl) save.mutate(url.trim()); }}>
            <Input value={url} onChange={(e) => setDraft(e.target.value)} placeholder="https://situs-anda.com/webhook" aria-label="Alamat webhook" aria-invalid={!validUrl} />
            <Button type="submit" disabled={!validUrl || draft === null || save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
          </form>
        )}
        {!validUrl && <p role="alert" className="text-sm text-destructive">Alamat harus diawali http:// atau https://</p>}
        <p className="text-xs text-muted-foreground">Belum punya server? Untuk mencoba, buat alamat sementara di webhook.site lalu tempel di sini.</p>
      </Section>

      <Section title="2. Kirim tes" hint="Kami kirim satu kejadian contoh (webhook.test) dan menunjukkan jawaban server Anda.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={!settings.data?.url || runTest.isPending || draft !== null} onClick={() => runTest.mutate()}>
            {runTest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Kirim tes
          </Button>
          {draft !== null ? <span className="text-sm text-muted-foreground">Simpan perubahan alamat dulu.</span> : !settings.data?.url && <span className="text-sm text-muted-foreground">Simpan alamat dulu.</span>}
        </div>
        {test && (
          <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${test.success ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10"}`}>
            {test.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
            <div>
              <p className="font-medium">{test.success ? `Berhasil, server Anda menjawab ${test.status} dalam ${test.duration_ms} ms.` : test.status ? `Server Anda menjawab ${test.status}. Webhook dianggap berhasil hanya jika jawabannya 2xx.` : "Server Anda tidak bisa dihubungi."}</p>
              {test.detail && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{test.detail}</p>}
            </div>
          </div>
        )}
      </Section>

      <Section title="3. Kunci tanda tangan" hint="Dipakai server Anda untuk memastikan kabar benar-benar dari kami, bukan dari orang iseng.">
        {settings.data && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{settings.data.secret_set ? <>Kunci aktif <span className="font-mono text-muted-foreground">whsec_…{settings.data.secret_hint}</span></> : "Belum ada kunci"}</p>
              <p className="text-xs text-muted-foreground">Kunci hanya tampil sekali saat dibuat. Membuat kunci baru langsung mengganti yang lama, jadi perbarui server Anda segera.</p>
            </div>
            {confirmRotate ? (
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>Ya, buat baru</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRotate(false)}>Batal</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => (settings.data?.secret_set ? setConfirmRotate(true) : rotate.mutate())}>
                <RefreshCw className="mr-2 h-4 w-4" />{settings.data.secret_set ? "Buat kunci baru" : "Buat kunci"}
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section title="4. Verifikasi di server Anda" hint="Setiap kiriman membawa tanda tangan HMAC-SHA256 dari isi pesan, di header X-Webhook-Signature. Hitung ulang dan bandingkan.">
        <CodeBlock tabs={VERIFY_SNIPPETS} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Hitung dari <strong>body mentah</strong>, bukan JSON yang sudah di-parse ulang. Beda satu spasi saja tanda tangannya berbeda.</li>
          <li>Simpan kunci di environment variable, jangan di kode atau repositori.</li>
          <li>Tolak permintaan dengan tanda tangan salah (balas 401).</li>
        </ul>
      </Section>

      <Section title="Kejadian yang dikirim">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Kejadian</TableHead><TableHead>Kapan</TableHead><TableHead>Biasanya Anda</TableHead></TableRow></TableHeader>
            <TableBody>{EVENTS.map((e) => (
              <TableRow key={e.name}><TableCell className="font-mono text-xs">{e.name}</TableCell><TableCell className="text-sm">{e.when}</TableCell><TableCell className="text-sm text-muted-foreground">{e.todo}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
        </div>
        <CodeBlock tabs={EXAMPLE_PAYLOADS} />
      </Section>

      <Section title="Aturan pengiriman">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li><strong>Balas 2xx dalam 10 detik.</strong> Selain itu dianggap gagal. Kerjakan proses yang berat setelah membalas.</li>
          <li><strong>Dicoba ulang 3 kali</strong> (setelah 1, 5, dan 15 detik). Sesudah itu kejadian dicatat gagal dan tidak dikirim lagi.</li>
          <li><strong>Bisa terkirim dobel.</strong> Jadikan proses Anda aman diulang: simpan <code className="font-mono text-xs">message_id</code> + <code className="font-mono text-xs">event</code> yang sudah diproses.</li>
          <li><strong>Urutan tidak dijamin.</strong> <code className="font-mono text-xs">read</code> bisa tiba sebelum <code className="font-mono text-xs">delivered</code>. Gunakan <code className="font-mono text-xs">timestamp</code>.</li>
          <li>Kami tidak mengikuti pengalihan (redirect). Pakai alamat akhir yang langsung menjawab.</li>
        </ul>
      </Section>

      <Section title="Pengiriman terakhir" hint="Diperbarui otomatis. Gunakan ini untuk mencari tahu kenapa webhook tidak masuk.">
        {logs.isLoading ? <Skeleton className="h-32" /> : (logs.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Belum ada pengiriman.</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Kejadian</TableHead><TableHead>Jawaban</TableHead><TableHead>Percobaan</TableHead><TableHead>Kapan</TableHead></TableRow></TableHeader>
              <TableBody>{logs.data!.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.event_type}</TableCell>
                  <TableCell>{l.response_status && l.response_status < 300 ? <Badge>{l.response_status}</Badge> : <Badge variant="destructive">{l.response_status ?? "tidak terhubung"}</Badge>}</TableCell>
                  <TableCell className="text-sm">{l.retry_count + 1}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatRelativeTime(l.created_at)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </Section>

      <SecretReveal
        open={secret !== null} title="Kunci webhook baru" secret={secret ?? ""}
        description="Tempel kunci ini ke environment variable WEBHOOK_SECRET di server Anda."
        warning="Salin sekarang. Kunci lama sudah tidak berlaku, dan kunci ini tidak bisa ditampilkan lagi."
        onDone={() => setSecret(null)}
      />
    </div>
  );
}
