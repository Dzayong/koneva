import Link from "next/link";

export function LegalLinksFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`border-t bg-background px-4 py-3 text-xs text-muted-foreground md:px-8 ${className}`}>
      <nav aria-label="Informasi legal" className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <Link href="/privasi" className="underline-offset-4 hover:text-foreground hover:underline">Kebijakan Privasi</Link>
        <Link href="/syarat" className="underline-offset-4 hover:text-foreground hover:underline">Syarat dan Ketentuan</Link>
      </nav>
    </footer>
  );
}
