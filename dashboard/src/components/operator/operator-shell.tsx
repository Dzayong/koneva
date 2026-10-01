"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, BarChart3, BellRing, CreditCard, GraduationCap, LayoutDashboard, LogOut, Menu, ScrollText, ShieldCheck } from "lucide-react";
import { KonevaMark } from "@/components/brand/koneva-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useOperatorLogout, useOperatorSession } from "@/hooks/use-operator";
import { operatorClient } from "@/lib/operator/client";
import { OperatorApiError } from "@/lib/operator/errors";
import type { OperatorPermission } from "@/lib/operator/types";
import { cn } from "@/lib/utils";

type OperatorNavItem = { href: string; label: string; icon: typeof LayoutDashboard; permission?: OperatorPermission };
const NAV_GROUPS: Array<{ label: string; items: OperatorNavItem[] }> = [
  { label: "UTAMA", items: [
    { href: "/operator", label: "Ringkasan", icon: LayoutDashboard },
  ] },
  { label: "OPERASIONAL", items: [
    { href: "/operator/payments", label: "Pembayaran", icon: CreditCard, permission: "payments:read" },
    { href: "/operator/students", label: "Pelajar", icon: GraduationCap, permission: "students:read" },
    { href: "/operator/audit", label: "Audit", icon: ScrollText, permission: "audit:read" },
    { href: "/operator/alerts", label: "Peringatan", icon: BellRing, permission: "audit:read" },
  ] },
  { label: "KHUSUS OWNER", items: [
    { href: "/operator/insights", label: "Panel Pemilik", icon: BarChart3, permission: "owner:insights" },
  ] },
];

/** Only same-origin operator paths are accepted as a return address. */
export const safeNext = (value: string | null): string => (value && /^\/operator(\/[\w\-./]*)?$/.test(value) && !value.startsWith("/operator/login") ? value : "/operator");

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("id-ID") ?? "").join("") || "OP";
}

function OperatorSidebar({
  pathname, name, email, can, onNavigate, onLogout, loggingOut,
}: {
  pathname: string; name: string; email: string; can: (permission: OperatorPermission) => boolean;
  onNavigate?: () => void; onLogout: () => void; loggingOut: boolean;
}) {
  const navId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <Link href="/operator" onClick={onNavigate} className="flex h-20 shrink-0 items-center gap-3 border-b border-sidebar-border px-6" aria-label="KONEVA, ringkasan operator">
        <KonevaMark className="h-10 w-10" />
        <div>
          <span className="text-lg font-bold tracking-[0.16em] text-sidebar-accent-foreground">KONEVA</span>
          <p className="mt-0.5 text-[11px] tracking-wide text-sidebar-foreground">Konsol platform</p>
        </div>
      </Link>

      <nav aria-label="Navigasi operator" className="flex-1 space-y-1 overflow-y-auto p-4">
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter((item) => !item.permission || can(item.permission));
          if (!visible.length) return null;
          return (
            <div key={group.label} className="space-y-1">
              <p className="mb-2 px-3 pt-4 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground">{group.label}</p>
              {visible.map((item) => {
                const isActive = item.href === "/operator" ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={isActive ? "page" : undefined}
                    className={cn("group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring", isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
                    {isActive && <motion.span layoutId={reduceMotion ? undefined : `${navId}-active`} className="absolute inset-0 rounded-lg bg-sidebar-accent" transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}><span className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-sidebar-primary" /></motion.span>}
                    <item.icon className={cn("relative h-[18px] w-[18px]", isActive && "text-sidebar-primary")} aria-hidden />
                    <span className="relative">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="mb-2 flex items-center gap-3 px-3 py-2">
          <Avatar><AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">{initials(name)}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{name}</p>
            <p className="truncate text-xs text-sidebar-foreground">{email}</p>
          </div>
        </div>
        <button type="button" onClick={onLogout} disabled={loggingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring disabled:opacity-50">
          <LogOut className="h-5 w-5" aria-hidden />Keluar
        </button>
      </div>
    </div>
  );
}

function titleFor(pathname: string): string {
  const all = NAV_GROUPS.flatMap((group) => group.items).sort((a, b) => b.href.length - a.href.length);
  return all.find((item) => item.href === "/operator" ? pathname === item.href : pathname.startsWith(item.href))?.label ?? "Panel Operator";
}

/** Sign-in gate and customer-dashboard-style frame; server routes still enforce every permission. */
export function OperatorShell({ children }: { children: React.ReactNode }) {
  const session = useOperatorSession();
  const logout = useOperatorLogout();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
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
    return <div className="mx-auto max-w-lg space-y-4 px-4 pt-20"><ForbiddenState text="Akun ini bukan operator platform atau tidak punya akses panel." /><div className="text-center"><Button variant="outline" onClick={() => { signingOut.current = true; logout.mutate(undefined, { onSettled: () => router.replace("/operator/login") }); }}>Keluar</Button></div></div>;
  }
  if (error || !session.data) return <div className="mx-auto max-w-lg px-4 pt-20"><ErrorState error={error} onRetry={() => void session.refetch()} /></div>;

  const me = session.data;
  const signOut = () => { signingOut.current = true; logout.mutate(undefined, { onSettled: () => router.replace("/operator/login?reason=logged_out") }); };
  const can = (permission: OperatorPermission) => session.can(permission);
  const sidebarProps = { pathname, name: me.operator.name, email: me.operator.email, can, onLogout: signOut, loggingOut: logout.isPending };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"><OperatorSidebar {...sidebarProps} /></aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka navigasi operator"><Menu className="h-5 w-5" /></Button>
              <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"><SheetTitle className="sr-only">Navigasi operator</SheetTitle><OperatorSidebar {...sidebarProps} onNavigate={() => setMobileOpen(false)} /></SheetContent>
            </Sheet>
            <div>
              <p className="hidden text-[10px] font-semibold tracking-[0.14em] text-muted-foreground sm:block">KONSOL INTERNAL</p>
              <p className="text-sm font-semibold sm:mt-1">{titleFor(pathname)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-4">
            <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground lg:flex"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />Operator</span>
            <ThemeToggle />
            <Avatar className="md:hidden"><AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initials(me.operator.name)}</AvatarFallback></Avatar>
            <div className="hidden min-w-0 text-right md:block"><p className="max-w-48 truncate text-sm font-medium">{me.operator.name}</p><p className="max-w-48 truncate text-xs text-muted-foreground">Akses internal</p></div>
          </div>
        </header>
        <div className="flex min-h-10 items-center gap-2 border-b bg-card/70 px-4 text-xs text-muted-foreground md:px-8"><Activity className="h-3.5 w-3.5 text-primary" aria-hidden /><span>Aktivitas internal tercatat · akses mengikuti izin akun</span></div>
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 py-6 md:p-8 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
