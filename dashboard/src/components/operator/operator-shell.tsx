"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, CreditCard, GraduationCap, LayoutDashboard, LogOut, ScrollText, ShieldCheck } from "lucide-react";
import { KonevaLogo } from "@/components/brand/koneva-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorLogout, useOperatorSession } from "@/hooks/use-operator";
import { operatorClient } from "@/lib/operator/client";
import { OperatorApiError } from "@/lib/operator/errors";
import type { OperatorPermission } from "@/lib/operator/types";
import { cn } from "@/lib/utils";

const NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard; permission?: OperatorPermission }> = [
  { href: "/operator", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/operator/payments", label: "Pembayaran", icon: CreditCard, permission: "payments:read" },
  { href: "/operator/students", label: "Pelajar", icon: GraduationCap, permission: "students:read" },
  { href: "/operator/audit", label: "Audit", icon: ScrollText, permission: "audit:read" },
  { href: "/operator/alerts", label: "Peringatan", icon: BellRing, permission: "audit:read" },
];

/** Only same-origin operator paths are accepted as a return address. */
export const safeNext = (value: string | null): string => (value && /^\/operator(\/[\w\-./]*)?$/.test(value) && !value.startsWith("/operator/login") ? value : "/operator");

/**
 * Sign-in gate and frame for every operator page. Hiding a menu item is convenience only: the server authorises each
 * request, and a 403 from it is shown as "Akses ditolak" rather than trusted away.
 */
export function OperatorShell({ children }: { children: React.ReactNode }) {
  const session = useOperatorSession();
  const logout = useOperatorLogout();
  const router = useRouter();
  const pathname = usePathname();

  // While signing out on purpose, the session vanishing is expected and must not look like an expiry.
  const signingOut = useRef(false);
  const goToLogin = (reason: "expired" | "required") => { if (!signingOut.current) router.replace(`/operator/login?reason=${reason}&next=${encodeURIComponent(pathname)}`); };

  useEffect(() => operatorClient.onSessionLost((reason) => goToLogin(reason === "expired" ? "expired" : "required")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname]);

  const error = session.error;
  useEffect(() => {
    if (error instanceof OperatorApiError && error.sessionLost) goToLogin(error.kind === "session_expired" ? "expired" : "required");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, pathname]);

  if (session.isLoading) return <div className="mx-auto max-w-md pt-24"><LoadingBlock label="Memeriksa sesi operator…" /></div>;
  if (error instanceof OperatorApiError && error.sessionLost) return <div className="mx-auto max-w-md pt-24"><LoadingBlock label="Mengalihkan ke halaman masuk…" /></div>;
  if (error instanceof OperatorApiError && (error.kind === "forbidden" || error.code === "NOT_OPERATOR")) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pt-20">
        <ForbiddenState text="Akun ini bukan operator platform atau tidak punya akses panel." />
        <div className="text-center"><Button variant="outline" onClick={() => { signingOut.current = true; logout.mutate(undefined, { onSettled: () => router.replace("/operator/login") }); }}>Keluar</Button></div>
      </div>
    );
  }
  if (error || !session.data) return <div className="mx-auto max-w-lg px-4 pt-20"><ErrorState error={error} onRetry={() => void session.refetch()} /></div>;

  const me = session.data;
  const items = NAV.filter((n) => !n.permission || session.can(n.permission));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-3">
            <Link href="/operator" aria-label="Panel Operator, beranda"><KonevaLogo markClassName="h-8 w-8" textClassName="text-base" /></Link>
            <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:flex"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Panel Operator</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm md:block"><p className="font-medium">{me.operator.name}</p><p className="text-xs text-muted-foreground">{me.operator.email}</p></div>
            <ThemeToggle />
            <Button variant="outline" size="sm" disabled={logout.isPending} onClick={() => { signingOut.current = true; logout.mutate(undefined, { onSettled: () => router.replace("/operator/login?reason=logged_out") }); }}><LogOut className="mr-1.5 h-4 w-4" />Keluar</Button>
          </div>
        </div>
        <nav aria-label="Panel operator" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 md:px-8">
          {items.map((n) => {
            const active = n.href === "/operator" ? pathname === "/operator" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <n.icon className="h-4 w-4" aria-hidden />{n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <p className="border-b bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground md:px-8">Setiap tindakan di panel ini dicatat di audit dengan identitas Anda.</p>
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
