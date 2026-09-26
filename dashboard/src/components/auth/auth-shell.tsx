import { KonevaLogo } from "@/components/brand/koneva-logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center">
          <KonevaLogo markClassName="h-10 w-10" textClassName="text-xl" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Consent line with links that open in a new tab (and do not toggle the checkbox they sit inside). */
export function TermsLabel() {
  const link = "font-medium text-primary underline underline-offset-2";
  return (
    <>
      Saya paham layanan ini terhubung ke WhatsApp lewat jalur tidak resmi, sehingga nomor saya bisa dibatasi atau diblokir oleh WhatsApp, dan saya bertanggung jawab atas pesan yang saya kirim. Saya menyetujui{" "}
      <a href="/syarat" target="_blank" rel="noopener noreferrer" className={link} onClick={(e) => e.stopPropagation()}>Syarat dan Ketentuan</a> serta{" "}
      <a href="/privasi" target="_blank" rel="noopener noreferrer" className={link} onClick={(e) => e.stopPropagation()}>Kebijakan Privasi</a>.
    </>
  );
}
