import { connection } from "next/server";
import { isSandbox } from "@/lib/sandbox";

/**
 * Server Component, deliberately not "use client": KONEVA_SANDBOX is a server-only env var (see lib/sandbox.ts).
 * `await connection()` opts this into per-request dynamic rendering so the env var is read fresh for the
 * process actually serving the request, instead of being resolved once during a static prerender at build
 * time and then reused for every instance — the same reason a `NEXT_PUBLIC_` build-time constant, or reading
 * the port out of the browser's `window.location`, is exactly what this must NOT do: either would show
 * whatever value the single shared build/bundle had, not this instance's own KONEVA_SANDBOX setting, so a
 * :13000 process serving that same build could end up showing (or hiding) the banner incorrectly.
 */
export async function DevBanner() {
  await connection();
  if (!isSandbox()) return null;
  return (
    <div
      data-testid="dev-sandbox-banner"
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[100] w-full bg-amber-500 px-4 py-1.5 text-center text-sm font-semibold text-amber-950"
    >
      DEV — Sandbox KONEVA. Bukan nomor WhatsApp atau data asli. Email dan WhatsApp sungguhan tidak dikirim dari sini.
    </div>
  );
}
