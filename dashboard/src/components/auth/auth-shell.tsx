import { MessageSquare } from "lucide-react";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <MessageSquare className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">WA Gateway</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export const TERMS_TEXT =
  "Saya paham layanan ini terhubung ke WhatsApp lewat jalur tidak resmi, sehingga nomor saya bisa dibatasi atau diblokir oleh WhatsApp, dan saya bertanggung jawab atas pesan yang saya kirim.";
