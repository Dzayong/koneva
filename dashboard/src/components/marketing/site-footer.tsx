"use client";

import Link from "next/link";
import { KonevaLogo } from "@/components/brand/koneva-logo";
import { usePublicInfo } from "@/hooks/use-billing";
import { PhotoBackdrop } from "./photo-backdrop";

const COLUMNS = [
  { title: "Produk", links: [{ label: "Tampilan asli", href: "/#tur" }, { label: "Keamanan nomor", href: "/#features" }, { label: "Saldo dan tarif", href: "/#harga" }, { label: "Pertanyaan umum", href: "/#faq" }] },
  { title: "Mulai", links: [{ label: "Buat akun", href: "/signup" }, { label: "Panduan pendaftaran", href: "/panduan/daftar-dan-klaim-voucher" }, { label: "Masuk", href: "/login" }, { label: "Dokumentasi API", href: "/docs" }] },
  { title: "Legal", links: [{ label: "Syarat dan Ketentuan", href: "/syarat" }, { label: "Kebijakan Privasi", href: "/privasi" }] },
];

/** Formal footer: identity, navigation, contact, and the disclosure a customer should read before paying. */
export function SiteFooter() {
  const contact = useInfoContact();
  return (
    <footer data-tone className="tone-ink relative overflow-hidden border-t">
      <PhotoBackdrop src="/media/photos/skyline-day.jpg" side="full" className="opacity-60" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#0a1224] via-[#0a1224]/80 to-[#0a1224]" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
        <div>
          <KonevaLogo />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">API WhatsApp dengan nomor Anda sendiri, inbox bersama untuk tim CS, status pengiriman, dan saldo prabayar.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{c.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {c.links.map((l) => (
                <li key={l.label}>{l.href.startsWith("/") ? <Link href={l.href} className="hover:text-primary">{l.label}</Link> : <a href={l.href} className="hover:text-primary">{l.label}</a>}</li>
              ))}
            </ul>
          </nav>
        ))}
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Kontak</p>
          <p className="mt-4 text-sm text-muted-foreground">
            {contact ? <>Pertanyaan sebelum mendaftar? <a href={`https://wa.me/${contact}`} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2">Chat lewat WhatsApp</a></> : "Kontak dukungan tersedia di dalam dashboard setelah Anda mendaftar."}
          </p>
        </div>
      </div>
      <div className="relative border-t">
        <div className="mx-auto max-w-7xl space-y-3 px-6 py-6 text-xs leading-relaxed text-muted-foreground">
          <p><strong className="font-semibold text-foreground">Pernyataan penting.</strong> KONEVA adalah layanan pihak ketiga dan tidak berafiliasi, disponsori, atau didukung oleh WhatsApp maupun Meta. Layanan ini memakai koneksi tidak resmi. WhatsApp menyatakan bahwa penggunaan aplikasi tidak resmi dapat berujung pada pembatasan atau pemblokiran nomor. Kami mengurangi risikonya, tetapi tidak menjaminnya.</p>
          <p>© {new Date().getFullYear()} KONEVA. Foto oleh kontributor Pexels dan Unsplash.</p>
        </div>
      </div>
    </footer>
  );
}

function useInfoContact(): string | null {
  const digits = usePublicInfo().data?.support_contact?.replace(/\D/g, "");
  return digits || null;
}
