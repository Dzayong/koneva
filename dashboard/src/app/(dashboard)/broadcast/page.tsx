"use client";

import { apiFailure, sendRejectionGuidance } from "@/lib/errors";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Radio, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TemplateBuilder } from "@/components/messages/template-builder";
import { useDevices } from "@/hooks/use-devices";
import { useRecipientContacts } from "@/hooks/use-contacts";
import { api } from "@/lib/api";
import { renderSpintax } from "@/lib/spintax";
import { formatPhoneNumber } from "@/lib/utils";

type SendStatus = "pending" | "sending" | "queued" | "quota_hold" | "failed";

interface RecipientState {
  phone: string;
  name: string;
  status: SendStatus;
  error?: string;
}

// api-gateway currently sends each message in its own request/transaction —
// this small delay between requests is a client-side courtesy (don't
// hammer the API in a tight loop), not a substitute for anti-ban.ts's real
// pacing, which still applies per-message server-side regardless.
const BROADCAST_SEND_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BroadcastPage() {
  const { data: devices } = useDevices();
  const { contacts } = useRecipientContacts();

  const onlineDevices = useMemo(() => devices?.filter((d) => d.status === "online") ?? [], [devices]);
  const [deviceKey, setDeviceKey] = useState("");
  const [template, setTemplate] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video" | "document">("image");
  const [manualNumbers, setManualNumbers] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [recipients, setRecipients] = useState<RecipientState[]>([]);
  const [isSending, setIsSending] = useState(false);

  const toggleContact = (id: string) => {
    setConsentConfirmed(false);
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildRecipientList = (): RecipientState[] => {
    const fromContacts = contacts
      .filter((c) => selectedContactIds.has(c.id))
      .map((c) => ({ phone: c.phone, name: c.name }));
    const fromManual = manualNumbers
      .split(/[\n,]/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((phone) => ({ phone: phone.replace(/\D/g, ""), name: "" }));

    const seen = new Set<string>();
    const merged: RecipientState[] = [];
    for (const r of [...fromContacts, ...fromManual]) {
      if (!r.phone || seen.has(r.phone)) continue;
      seen.add(r.phone);
      merged.push({ ...r, status: "pending" });
    }
    return merged;
  };

  const handleSend = async () => {
    if (!deviceKey) {
      toast.error("Pilih device dulu");
      return;
    }
    if (!template.trim() && !mediaUrl.trim()) {
      toast.error("Tulis pesan atau isi alamat gambar dulu");
      return;
    }
    if (mediaUrl.trim() && !/^https:\/\//i.test(mediaUrl.trim())) {
      toast.error("Alamat berkas harus diawali https://");
      return;
    }
    const list = buildRecipientList();
    if (list.length === 0) {
      toast.error("Belum ada penerima", { description: "Pilih kontak atau tempel nomor telepon." });
      return;
    }
    if (!consentConfirmed) {
      toast.error("Konfirmasi izin penerima dulu", {
        description: "Pastikan semua nomor di daftar ini memang sudah setuju menerima pesan WhatsApp.",
      });
      return;
    }

    setRecipients(list);
    setIsSending(true);
    try {
      await api.recordBroadcastConsent(list.map((recipient) => recipient.phone));
    } catch (err) {
      const failure = apiFailure(err, "Konfirmasi izin gagal");
      const message = failure.code === "RECIPIENT_OPTED_OUT"
        ? "Ada penerima yang pernah meminta berhenti. Tidak ada pesan yang dikirim; keluarkan nomor tersebut dari daftar."
        : failure.message;
      setRecipients(list.map((recipient) => ({ ...recipient, status: "failed", error: message })));
      setIsSending(false);
      toast.error("Tidak ada pesan yang dikirim", { description: message });
      return;
    }
    let queuedCount = 0;
    let quotaHoldCount = 0;
    let failedCount = 0;
    let firstFailureMessage: string | undefined;

    for (let i = 0; i < list.length; i++) {
      const recipient = list[i]!;
      setRecipients((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "sending" } : r)),
      );

      const content = renderSpintax(template, { nama: recipient.name || recipient.phone });

      try {
        const result = await api.sendMessage({ device_key: deviceKey, to: recipient.phone, message: content, ...(mediaUrl.trim() ? { media_url: mediaUrl.trim(), media_type: mediaType } : {}) });
        const status = result.status === "quota_hold" ? "quota_hold" : "queued";
        if (status === "quota_hold") quotaHoldCount++;
        else queuedCount++;
        setRecipients((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status } : r)),
        );
      } catch (err) {
        failedCount++;
        const failure = apiFailure(err, "Gagal");
        firstFailureMessage ??= failure.message;
        const guidance = sendRejectionGuidance(failure.code);
        const message = guidance ? `${guidance.title}: ${guidance.description}` : failure.message;
        setRecipients((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: message } : r)),
        );
      }

      if (i < list.length - 1) await sleep(BROADCAST_SEND_DELAY_MS);
    }

    setIsSending(false);
    const outcome = `${queuedCount} masuk antrean · ${quotaHoldCount} ditahan karena kuota · ${failedCount} gagal`;
    if (failedCount === 0 && quotaHoldCount === 0) {
      toast.success("Semua pesan masuk antrean", { description: outcome });
    } else if (queuedCount > 0) {
      toast.warning("Broadcast selesai dengan kendala", { description: [outcome, firstFailureMessage].filter(Boolean).join(". ") });
    } else if (quotaHoldCount > 0 && failedCount === 0) {
      toast.warning("Pesan belum masuk antrean", { description: outcome });
    } else {
      toast.error("Tidak ada pesan yang masuk antrean", { description: [outcome, firstFailureMessage].filter(Boolean).join(". ") });
    }
  };

  const recipientCount = selectedContactIds.size + manualNumbers.split(/[\n,]/).filter((n) => n.trim()).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-display">Broadcast</h2>
        <p className="text-muted-foreground">
          Kirim pesan bertemplat ke banyak penerima.
        </p>
      </div>

      <div role="note" className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p><span className="font-semibold">Perhatikan risiko broadcast.</span> Pengiriman ke banyak nomor dapat membuat WhatsApp membatasi nomor pengirim. Kirim hanya kepada penerima yang sudah setuju menerima pesan; pembatasan nomor tetap dapat terjadi.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Device pengirim</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={deviceKey} onValueChange={setDeviceKey}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih device yang online" />
                </SelectTrigger>
                <SelectContent>
                  {onlineDevices.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">Tidak ada device online</div>
                  ) : (
                    onlineDevices.map((d) => (
                      <SelectItem key={d.id} value={d.device_key}>
                        {d.label || d.device_key}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Penerima ({recipientCount})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {contacts.length > 0 && (
                <div className="space-y-2">
                  <Label>Dari kontak</Label>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {contacts.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedContactIds.has(c.id)}
                          onChange={() => toggleContact(c.id)}
                        />
                        {c.name} — {formatPhoneNumber(c.phone)}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="manualNumbers">Atau tempel nomor telepon (satu per baris)</Label>
                <Textarea
                  id="manualNumbers"
                  rows={4}
                  placeholder={"6281234567890\n6281234567891"}
                  value={manualNumbers}
                  onChange={(e) => {
                    setManualNumbers(e.target.value);
                    setConsentConfirmed(false);
                  }}
                />
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={consentConfirmed}
                  onChange={(event) => setConsentConfirmed(event.target.checked)}
                  disabled={isSending}
                  aria-label="Konfirmasi izin penerima"
                />
                <span>
                  Saya memastikan semua nomor yang dipilih atau ditempel di atas telah memberi izin menerima pesan WhatsApp dari bisnis ini. Konfirmasi ini dicatat atas nama akun saya. Nomor yang pernah meminta berhenti tetap diblokir.
                </span>
              </label>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>3. Pesan</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateBuilder value={template} onChange={setTemplate} />
            <p className="mt-3 text-xs text-muted-foreground">Tautan (misalnya https://toko-anda.com/promo) yang Anda tulis di pesan bisa langsung diketuk penerima.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gambar atau berkas (opsional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {([["image", "Gambar"], ["video", "Video"], ["document", "Dokumen"]] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={mediaType === id} onClick={() => setMediaType(id)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${mediaType === id ? "border-primary bg-accent font-medium" : "text-muted-foreground"}`}>{label}</button>
              ))}
            </div>
            <Label htmlFor="mediaUrl">Alamat berkas (https)</Label>
            <input id="mediaUrl" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} inputMode="url" placeholder="https://situs-anda.com/promo.jpg"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
            {mediaUrl && !/^https:\/\//i.test(mediaUrl.trim()) && <p role="alert" className="text-sm text-destructive">Alamat harus diawali https://</p>}
            <p className="text-xs text-muted-foreground">Teks di atas menjadi keterangan gambar.</p>
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSend} disabled={isSending} size="lg">
        {isSending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Mengirim...
          </>
        ) : (
          <>
            <Radio className="mr-2 h-4 w-4" />
            Kirim broadcast
          </>
        )}
      </Button>

      {recipients.length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Penerima</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => (
                <TableRow key={r.phone}>
                  <TableCell>
                    {r.name ? `${r.name} — ` : ""}
                    {formatPhoneNumber(r.phone)}
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" && (
                      <span className="text-muted-foreground">Menunggu</span>
                    )}
                    {r.status === "sending" && (
                      <span className="flex items-center gap-1 text-blue-600">
                        <Loader2 className="h-3 w-3 animate-spin" /> Mengirim
                      </span>
                    )}
                    {r.status === "queued" && (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Masuk antrean
                      </span>
                    )}
                    {r.status === "quota_hold" && (
                      <span className="text-amber-600">Ditahan: kuota habis</span>
                    )}
                    {r.status === "failed" && (
                      <span className="flex items-center gap-1 text-red-600">
                        <XCircle className="h-3 w-3" /> {r.error || "Gagal"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
