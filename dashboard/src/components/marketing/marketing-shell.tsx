import Link from "next/link";
import { Zap } from "lucide-react";
import { SiteFooter } from "./site-footer";

/** Frame for the plain public pages (docs, terms, privacy): light header, readable column, shared footer. */
export function MarketingShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="tone-cream min-h-screen bg-background">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-3" aria-label="WA Gateway, beranda">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563eb] to-[#06b6d4]"><Zap className="h-4 w-4 text-white" /></span>
          <span className="text-lg font-semibold">WA Gateway</span>
        </Link>
        <nav aria-label="Utama" className="flex items-center gap-5 text-sm font-medium">
          <Link href="/docs" className="hover:text-primary">Dokumentasi</Link>
          <Link href="/#harga" className="hover:text-primary">Harga</Link>
          <Link href="/login" className="rounded-lg border px-3 py-1.5 hover:border-primary/40">Masuk</Link>
        </nav>
      </header>
      <main className={wide ? "mx-auto max-w-7xl px-6 pt-8 pb-24" : "mx-auto max-w-3xl px-6 pt-8 pb-24"}>{children}</main>
      <SiteFooter />
    </div>
  );
}
