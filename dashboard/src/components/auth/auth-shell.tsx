import { KonevaLogo } from "@/components/brand/koneva-logo";
import { LegalLinksFooter } from "@/components/layout/legal-links-footer";

// Local assets only (dashboard/public/, see ASSETS.md for source/license/creator/date); never hotlinked.
const BACKGROUND_IMAGE = {
  login: "/auth-bg-login.jpg",
  signup: "/auth-bg-signup.jpg",
} as const;

export function AuthShell({
  children,
  background,
}: {
  children: React.ReactNode;
  /** Dark mesh photo behind the form, or the plain muted background when omitted (e.g. the invite-accept page). */
  background?: keyof typeof BACKGROUND_IMAGE;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-muted/50">
      {background && (
        <>
          <div
            aria-hidden
            data-testid="auth-background"
            data-background={background}
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${BACKGROUND_IMAGE[background]})` }}
          />
          {/* ~40% dark overlay so the card and logo stay readable over the photo, in both color schemes. */}
          <div aria-hidden data-testid="auth-background-overlay" className="absolute inset-0 bg-black/40" />
        </>
      )}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-center">
            <KonevaLogo markClassName="h-10 w-10" textClassName={background ? "text-xl text-white" : "text-xl"} />
          </div>
          {children}
        </div>
      </main>
      <LegalLinksFooter className="relative z-10 bg-background/90" />
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
