import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, CircleHelp, TicketPercent } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Cara daftar akun dan klaim voucher saldo",
  description: "Ikuti langkah pendaftaran KONEVA, verifikasi nomor WhatsApp, dan masukkan voucher saldo saat membuat akun.",
  alternates: { canonical: "/panduan/daftar-dan-klaim-voucher" },
  openGraph: {
    url: "/panduan/daftar-dan-klaim-voucher",
    title: "Cara daftar akun dan klaim voucher saldo · KONEVA",
    description: "Panduan pendaftaran akun KONEVA dengan atau tanpa voucher saldo.",
  },
};

const steps = [
  ["01", "Isi data akun", "Masukkan nama, email aktif, kata sandi minimal 10 karakter, dan nomor WhatsApp yang bisa menerima pesan. Nama workspace boleh dikosongkan."],
  ["02", "Tambahkan voucher bila ada", "Tempel kode voucher dari admin pada kolom Kode voucher. Kolom ini opsional untuk pendaftaran biasa."],
  ["03", "Verifikasi nomor WhatsApp", "Tekan Buat akun. Buka WhatsApp pada nomor yang didaftarkan, ambil kode 6 digit dari pesan KONEVA, lalu masukkan di layar verifikasi."],
  ["04", "Mulai gunakan akun", "Setelah kode benar, akun aktif dan Anda masuk ke dashboard. Jika memakai voucher, kredit saldo ditambahkan saat akun diaktifkan."],
] as const;

export default function SignupVoucherGuidePage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/" className="hover:text-primary">Beranda</Link><span className="mx-2">/</span>
          <span aria-current="page">Panduan daftar dan voucher</span>
        </nav>

        <header className="mt-8">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Panduan akun</p>
          <h1 className="mt-3 font-display text-4xl leading-tight md:text-5xl">Daftar akun dan klaim voucher saldo</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">Ikuti alurnya dari mengisi formulir sampai masuk ke dashboard. Pendaftar tanpa voucher dan penerima voucher memakai formulir yang sama.</p>
        </header>

        <section className="mt-8 rounded-2xl border bg-card p-5 md:p-7" aria-labelledby="tutorial-video-title">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary"><TicketPercent className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <h2 id="tutorial-video-title" className="font-semibold">Ikuti rekaman tutorial</h2>
              <p className="mt-1 text-sm text-muted-foreground">Pilih alur yang sesuai. Rekaman memakai data contoh dan simulasi; kode OTP akun asli hanya dikirim ke WhatsApp Anda.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-6">
            <div>
              <h3 className="font-semibold">Daftar tanpa voucher</h3>
              <video className="mt-3 aspect-video w-full rounded-xl border bg-muted" controls preload="metadata" playsInline poster="/media/tutorial-daftar-biasa-poster.jpg" aria-label="Tutorial membuat akun KONEVA tanpa voucher">
                <source src="/media/tutorial-daftar-biasa.webm" type="video/webm" />
                Browser Anda belum mendukung pemutar video.
              </video>
            </div>
            <div>
              <h3 className="font-semibold">Daftar dengan voucher</h3>
              <video className="mt-3 aspect-video w-full rounded-xl border bg-muted" controls preload="metadata" playsInline poster="/media/tutorial-daftar-voucher-poster.jpg" aria-label="Tutorial membuat akun KONEVA dengan voucher saldo">
                <source src="/media/tutorial-daftar-voucher.webm" type="video/webm" />
                Browser Anda belum mendukung pemutar video.
              </video>
            </div>
          </div>
          <details className="mt-5 rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">Baca narasi tutorial</summary>
            <p className="mt-3 leading-relaxed text-muted-foreground">“Buka halaman Buat akun. Isi nama, email, kata sandi, dan nomor WhatsApp. Kalau punya voucher dari admin, masukkan kodenya di kolom Kode voucher; kalau tidak, biarkan kosong. Setujui syarat, lalu tekan Buat akun. Buka WhatsApp dan masukkan kode enam digit yang Anda terima. Setelah verifikasi berhasil, Anda masuk ke dashboard. Kredit voucher akan muncul di saldo akun.”</p>
          </details>
        </section>

        <section className="mt-12" aria-labelledby="daftar-title">
          <h2 id="daftar-title" className="font-display text-3xl">Empat langkah untuk kedua jenis pendaftar</h2>
          <ol className="mt-6 space-y-3">
            {steps.map(([number, title, description]) => (
              <li key={number} className="grid gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-[3rem_1fr]">
                <span className="font-mono text-sm font-semibold text-primary">{number}</span>
                <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-2" aria-label="Perbedaan pendaftaran">
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="font-display text-2xl">Daftar tanpa voucher</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Isi formulir dan verifikasi WhatsApp seperti biasa. Setelah masuk, Anda dapat melihat saldo serta tarif dari menu Tagihan.</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Kolom voucher boleh dikosongkan.</li>
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Email digunakan untuk akun dan pemulihan kata sandi.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-primary/25 bg-primary/[0.035] p-6">
            <h2 className="font-display text-2xl">Daftar dengan voucher</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Masukkan kode yang diberikan admin sebelum menekan Buat akun. Kredit masuk otomatis setelah nomor WhatsApp berhasil diverifikasi.</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Pastikan kode benar dan belum kedaluwarsa.</li>
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Cek nominal kredit di menu Tagihan setelah masuk.</li>
            </ul>
          </div>
        </section>

        <aside className="mt-8 flex gap-3 rounded-2xl border bg-muted/50 p-5 text-sm" aria-label="Catatan klaim voucher">
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="leading-relaxed text-muted-foreground"><strong className="text-foreground">Klaim voucher dilakukan saat pendaftaran.</strong> Masukkan kode sebelum membuat akun. Saat ini belum ada formulir klaim voucher terpisah untuk akun yang sudah aktif. Jika kode tidak ditemukan, kedaluwarsa, atau kuotanya habis, minta kode baru kepada admin.</p>
        </aside>

        <section className="mt-12 rounded-2xl bg-foreground p-6 text-background md:p-8">
          <h2 className="font-display text-3xl">Siap membuat akun?</h2>
          <p className="mt-2 text-sm text-background/75">Siapkan nomor WhatsApp yang aktif. Voucher bersifat opsional.</p>
          <Button asChild className="mt-5" variant="secondary"><Link href="/signup">Mulai pendaftaran <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button>
        </section>
      </article>
    </MarketingShell>
  );
}
