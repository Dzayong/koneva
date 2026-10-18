"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, QrCode, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorSession, usePairSystemWhatsappOtpSender, useSaveSystemWhatsappNotifications, useSystemWhatsappOtpQr, useSystemWhatsappOtpSender, useTestSystemWhatsappNotifications } from "@/hooks/use-operator";

const statusText: Record<string, string> = {
  not_configured: "Belum ditautkan", starting: "Menyiapkan koneksi", pending_qr: "Menunggu scan QR",
  online: "Terhubung", offline: "Terputus", paused: "Dijeda", error: "Ada masalah koneksi", banned: "Diblokir WhatsApp",
};
const otpMessageStatusText: Record<string, string> = {
  pending: "Belum masuk antrean", queued: "Dalam antrean", sending: "Sedang dikirim", sent: "Terkirim ke WhatsApp",
  delivered: "Diterima", read: "Dibaca", failed: "Gagal", blocked: "Diblokir",
};
const otpVerificationStatusText: Record<string, string> = { pending: "Belum dipakai", used: "Terverifikasi", expired: "Kedaluwarsa", invalidated: "Tidak berlaku" };

const notificationEvents = [
  { event: "Signup workspace", trigger: "Pendaftaran pengguna berhasil diverifikasi dan workspace diaktifkan.", message: "Signup baru KONEVA: nama workspace.", recipient: "Nomor WhatsApp operator", followUp: "Sekali per workspace baru." },
  { event: "Pembayaran lunas", trigger: "Invoice berubah menjadi lunas.", message: "Nama workspace, nomor invoice, dan nominal pembayaran.", recipient: "Nomor WhatsApp operator", followUp: "Sekali per invoice yang lunas." },
  { event: "Pengajuan Pelajar", trigger: "Pengguna mengirim pengajuan verifikasi paket Pelajar.", message: "Ada pengajuan verifikasi paket Pelajar baru.", recipient: "Nomor WhatsApp operator", followUp: "Sekali saat pengajuan dibuat." },
  { event: "Keputusan pengajuan Pelajar", trigger: "Operator menyetujui atau menolak pengajuan.", message: "Workspace dan hasil keputusan (disetujui/ditolak).", recipient: "Nomor WhatsApp operator", followUp: "Sekali setiap keputusan baru." },
  { event: "Perubahan status device", trigger: "Device mencapai status stabil: online, offline, diblokir, keluar, atau error. Status transisi sementara diabaikan.", message: "Device key, status baru, dan status sebelumnya jika ada.", recipient: "Nomor WhatsApp operator", followUp: "Sekali per transisi status yang tercatat." },
  { event: "Ambang kapasitas OTP", trigger: "Penggunaan mencapai 70% atau cap harian tercapai.", message: "Jenis peringatan dan jumlah/cap, tanpa data pribadi.", recipient: "Nomor WhatsApp operator", followUp: "Maksimal sekali per jenis dalam 24 jam." },
  { event: "Login operator darurat", trigger: "Akun operator break-glass berhasil masuk.", message: "Peringatan keamanan dan nama akun darurat.", recipient: "Nomor WhatsApp operator", followUp: "Sekali setiap login berhasil." },
];

export default function SystemWhatsappOtpPage() {
  const { can } = useOperatorSession();
  const sender = useSystemWhatsappOtpSender(can("owner:insights"));
  const pair = usePairSystemWhatsappOtpSender();
  const saveNotifications = useSaveSystemWhatsappNotifications();
  const testNotifications = useTestSystemWhatsappNotifications();
  const qr = useSystemWhatsappOtpQr();
  const [showQr, setShowQr] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [notificationsEnabledOverride, setNotificationsEnabledOverride] = useState<boolean | null>(null);

  if (!can("owner:insights")) return <ForbiddenState text="Pengaturan ini hanya untuk pemilik sistem." />;
  if (sender.isLoading) return <LoadingBlock label="Memeriksa pengirim OTP WhatsApp..." />;
  if (sender.error || !sender.data) return <ErrorState error={sender.error} onRetry={() => void sender.refetch()} />;
  const state = sender.data;
  const notificationsEnabled = notificationsEnabledOverride ?? state.notifications_enabled;
  const saveNotificationSettings = async (enabled: boolean) => {
    await saveNotifications.mutateAsync({ ...(recipientPhone.trim() ? { recipient_phone: recipientPhone.trim() } : {}), enabled });
    setRecipientPhone("");
    setNotificationsEnabledOverride(null);
  };
  const startPairing = async () => {
    await pair.mutateAsync();
    await sender.refetch();
  };
  const loadQr = async () => {
    await qr.mutateAsync();
    setShowQr(true);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-label text-primary">PENGATURAN SISTEM</p>
        <h1 className="text-display mt-2">Pengirim OTP WhatsApp</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Tautkan satu nomor WhatsApp khusus KONEVA. Nomor ini akan dipakai untuk mengirim kode verifikasi saat pengguna baru memilih WhatsApp.</p>
      </header>

      <Card className="space-y-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><Smartphone className="h-5 w-5" aria-hidden /></div>
            <div>
              <h2 className="font-semibold">Nomor pengirim sistem</h2>
              <p className="text-sm text-muted-foreground">Device ini dikelola oleh KONEVA, terpisah dari workspace pelanggan.</p>
            </div>
          </div>
          <Badge variant={state.status === "online" ? "default" : "outline"} className="gap-1.5">
            {state.status === "online" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
            {statusText[state.status] ?? state.status}
          </Badge>
        </div>

        {state.device_key && <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Device: </span><code>{state.device_key}</code>
          {state.phone_last4 && <span className="ml-3 text-muted-foreground">Nomor berakhir •••• {state.phone_last4}</span>}
        </div>}

        {!state.configured && <div className="space-y-3">
          <p className="text-sm">Mulai dengan membuat device pengirim khusus. Setelah itu panel akan menampilkan QR untuk dipindai.</p>
          <Button onClick={() => void startPairing()} disabled={pair.isPending}>
            {pair.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Siapkan device dan tampilkan QR
          </Button>
          {pair.error && <p role="alert" className="text-sm text-destructive">{pair.error.message}</p>}
        </div>}

        {state.configured && state.status === "pending_qr" && <div className="space-y-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
            Di WhatsApp pada ponsel pengirim: buka <strong>Setelan → Perangkat tertaut → Tautkan perangkat</strong>, lalu pindai QR di bawah.
          </div>
          {!showQr && <Button variant="outline" onClick={() => void loadQr()} disabled={qr.isPending}>
            {qr.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <QrCode className="mr-2 h-4 w-4" aria-hidden />}
            Tampilkan QR
          </Button>}
          {showQr && qr.data?.qr_code && <div className="inline-flex rounded-xl border bg-white p-4">
            <QRCodeSVG value={qr.data.qr_code} size={240} level="M" aria-label="QR untuk menautkan WhatsApp pengirim OTP" />
          </div>}
          {showQr && qr.data?.qr_code && <div><Button variant="outline" onClick={() => void loadQr()} disabled={qr.isPending}>Muat ulang QR</Button></div>}
          {showQr && !qr.data?.qr_code && <div className="space-y-2">
            <p className="text-sm text-muted-foreground">QR belum tersedia. Tunggu beberapa detik lalu muat QR lagi.</p>
            <Button variant="outline" onClick={() => void loadQr()} disabled={qr.isPending}>Muat ulang QR</Button>
          </div>}
          {qr.error && <p role="alert" className="text-sm text-destructive">{qr.error.message}</p>}
          <p className="text-xs text-muted-foreground">Status koneksi diperiksa otomatis setiap 3 detik. QR hanya ditampilkan kepada pemilik sistem dan tidak disimpan di browser setelah halaman ditutup.</p>
        </div>}

        {state.configured && state.status === "online" && <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
          Pengirim WhatsApp sudah tersambung dan siap mengirim OTP pendaftaran. {state.phone_last4 ? `Nomor terhubung berakhir •••• ${state.phone_last4}.` : "Nomor pengirim aktif."}
        </div>}

        {state.configured && !["pending_qr", "online"].includes(state.status) && <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
          <p>Device pengirim belum online. Periksa koneksi ponsel dan WhatsApp. Status akan diperbarui otomatis.</p>
          {state.status === "error" && <p className="text-muted-foreground">Jika device gagal pulih, hubungi operator teknis untuk mengatur ulang device pengirim.</p>}
        </div>}
      </Card>

      <Card className="space-y-4 shadow-card">
        <div>
          <h2 className="font-semibold">Aktivitas OTP signup terbaru</h2>
          <p className="mt-1 text-sm text-muted-foreground">Status antrean dan tanda terima WhatsApp ditampilkan terpisah dari status verifikasi. Kode OTP dan nomor lengkap tidak ditampilkan.</p>
        </div>
        {state.recent_otps.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada permintaan OTP WhatsApp tercatat.</p> :
          <>
          <div className="space-y-3 md:hidden">
            {state.recent_otps.map((otp) => (
              <article key={otp.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-3"><p className="font-medium">{new Date(otp.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p><Badge variant={otp.message_status === "failed" || otp.message_status === "blocked" ? "destructive" : "secondary"}>{otpMessageStatusText[otp.message_status] ?? "Status tidak diketahui"}</Badge></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                  <div><dt className="text-xs text-muted-foreground">Penerima</dt><dd>•••• {otp.phone_last4 ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Verifikasi</dt><dd>{otpVerificationStatusText[otp.verification_status]}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Percobaan</dt><dd>{otp.attempts}/5</dd></div>
                  {otp.error_code && <div><dt className="text-xs text-muted-foreground">Kode error</dt><dd className="text-destructive">{otp.error_code}</dd></div>}
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-muted/60 text-xs"><tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Waktu</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Penerima</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status WhatsApp</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Verifikasi</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Percobaan</th>
              </tr></thead>
              <tbody className="divide-y">{state.recent_otps.map((otp) => <tr key={otp.id}>
                <td className="whitespace-nowrap px-3 py-3">{new Date(otp.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</td>
                <td className="px-3 py-3">•••• {otp.phone_last4 ?? "—"}</td>
                <td className="px-3 py-3">
                  <span>{otpMessageStatusText[otp.message_status] ?? "Status tidak diketahui"}</span>
                  {otp.error_code && <span className="mt-1 block text-xs text-destructive">Kode: {otp.error_code}</span>}
                  {otp.sent_at && <span className="mt-1 block text-xs text-muted-foreground">Terkirim {new Date(otp.sent_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}</span>}
                  {otp.delivered_at && <span className="mt-1 block text-xs text-muted-foreground">Diterima {new Date(otp.delivered_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}</span>}
                  {otp.read_at && <span className="mt-1 block text-xs text-muted-foreground">Dibaca {new Date(otp.read_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}</span>}
                </td>
                <td className="px-3 py-3">{otpVerificationStatusText[otp.verification_status]}</td>
                <td className="px-3 py-3">{otp.attempts}/5</td>
              </tr>)}</tbody>
            </table>
          </div>
          </>}
      </Card>

      <Card className="space-y-5 shadow-card">
        <div>
          <h2 className="font-semibold">Notifikasi WhatsApp untuk operator</h2>
          <p className="mt-1 text-sm text-muted-foreground">Pesan dikirim dari nomor sistem yang sama ke nomor operator yang kamu atur di sini. OTP signup tetap mendapat prioritas tinggi; notifikasi biasa memakai antrean normal dengan jeda acak 5–30 detik.</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Daftar event dan tindak lanjut notifikasi</h3>
          <div className="space-y-3 md:hidden">
            {notificationEvents.map((item) => (
              <article key={item.event} className="rounded-lg border p-3 text-sm">
                <h4 className="font-semibold">{item.event}</h4>
                <dl className="mt-3 space-y-3">
                  <div><dt className="text-xs font-medium text-muted-foreground">Dikirim saat</dt><dd className="mt-0.5">{item.trigger}</dd></div>
                  <div><dt className="text-xs font-medium text-muted-foreground">Isi ringkas</dt><dd className="mt-0.5">{item.message}</dd></div>
                  <div className="grid grid-cols-2 gap-3"><div><dt className="text-xs font-medium text-muted-foreground">Penerima</dt><dd className="mt-0.5">{item.recipient}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Pengulangan</dt><dd className="mt-0.5">{item.followUp}</dd></div></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Event</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Dikirim saat</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Isi ringkas</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Penerima</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Pengulangan / lanjutan</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {notificationEvents.map((item) => (
                  <tr key={item.event} className="align-top">
                    <th scope="row" className="whitespace-nowrap px-3 py-3 font-medium">{item.event}</th>
                    <td className="px-3 py-3 text-muted-foreground">{item.trigger}</td>
                    <td className="px-3 py-3 text-muted-foreground">{item.message}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{item.recipient}</td>
                    <td className="px-3 py-3 text-muted-foreground">{item.followUp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Notifikasi tidak mengirim pengingat berkala. Jika pengiriman gagal sementara, sistem mencoba kembali lewat antrean dengan jeda bertahap (maksimal 8 percobaan); ini retry teknis, bukan notifikasi baru.</p>
        </div>
        <label className="block space-y-2 text-sm font-medium">
          Nomor WhatsApp operator penerima
          <input className="w-full rounded-md border bg-background px-3 py-2" type="tel" inputMode="tel" autoComplete="tel" placeholder={state.notification_recipient_last4 ? `Nomor tersimpan berakhir •••• ${state.notification_recipient_last4}` : "08xx atau 628xx"} value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} />
          <span className="block text-xs font-normal text-muted-foreground">Nomor lengkap disimpan di server dan tidak ditampilkan kembali. Kosongkan untuk memakai nomor tersimpan.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void saveNotificationSettings(false)} disabled={saveNotifications.isPending}>
            {saveNotifications.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Simpan nomor
          </Button>
          <Button variant="outline" onClick={() => void testNotifications.mutateAsync()} disabled={testNotifications.isPending || state.status !== "online" || !state.notification_recipient_last4 || Boolean(recipientPhone.trim())}>
            {testNotifications.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Kirim pesan uji
          </Button>
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
          <input type="checkbox" className="mt-1" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabledOverride(event.target.checked)} />
          <span><strong>Aktifkan semua notifikasi sistem penting</strong><span className="mt-1 block text-muted-foreground">Mencakup semua event dalam tabel di atas. Aktifkan setelah pesan uji diterima di nomor operator.</span></span>
        </label>
        <Button onClick={() => void saveNotificationSettings(notificationsEnabled)} disabled={saveNotifications.isPending || (notificationsEnabled && !state.notification_test_queued_at)}>
          {saveNotifications.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Simpan pengaturan notifikasi
        </Button>
        {state.notification_recipient_last4 && <p className="text-xs text-muted-foreground">Penerima tersimpan: •••• {state.notification_recipient_last4} · {state.notifications_enabled ? "notifikasi aktif" : "notifikasi nonaktif"}{state.notification_test_queued_at ? " · pesan uji pernah dimasukkan ke antrean" : ""}</p>}
        {(saveNotifications.error || testNotifications.error) && <p role="alert" className="text-sm text-destructive">{saveNotifications.error?.message ?? testNotifications.error?.message}</p>}
        {testNotifications.data?.queued && <p role="status" className="text-sm text-success">Pesan uji masuk ke antrean untuk nomor berakhir •••• {testNotifications.data.recipient_last4}. Pastikan pesan diterima sebelum mengaktifkan notifikasi.</p>}
      </Card>

      <p className="text-xs text-muted-foreground">Pengaturan ini berlaku untuk sistem KONEVA yang sedang dibuka. OTP WhatsApp membuktikan kepemilikan nomor, bukan verifikasi alamat email.</p>
    </div>
  );
}
