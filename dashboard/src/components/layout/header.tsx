"use client";

import { ROLE_LABEL } from "@/lib/roles";
import { useState } from "react";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { usePermissions } from "@/hooks/use-me";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { NotificationCenter } from "./notification-center";
import { HelpButton, TrialChip } from "./header-extras";
import { GlobalSearch } from "./global-search";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Ringkasan",
  "/devices": "Device",
  "/messages": "Pesan",
  "/broadcast": "Broadcast",
  "/campaigns": "Campaign Terjadwal",
  "/contacts": "Kontak",
  "/status": "Status WhatsApp",
  "/analytics": "Analitik",
  "/settings": "Pengaturan",
  "/settings/auto-reply": "Balas otomatis",
  "/developers/quickstart": "Mulai cepat",
  "/developers/keys": "Kunci API",
  "/developers/webhooks": "Webhook",
  "/billing": "Tagihan",
  "/team": "Tim",
  "/activity": "Aktivitas",
};

function pageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/devices/")) return "Detail device";
  return "KONEVA";
}


function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "WA";
}

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, workspace, role } = usePermissions();

  return (
    <header className="sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-sm md:px-8">
      <div className="flex items-center gap-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Buka navigasi"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
            <SheetTitle className="sr-only">Navigasi</SheetTitle>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div>
          <p className="hidden text-[10px] font-semibold tracking-[0.14em] text-muted-foreground sm:block">WORKSPACE</p>
          <h1 className="text-sm font-semibold sm:mt-1">{pageTitle(pathname)}</h1>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        <GlobalSearch />
        <Badge variant="outline" className="hidden border-border bg-card px-2.5 py-1 font-medium lg:flex">
          {workspace?.name ?? "…"}
        </Badge>
        <TrialChip />
        <HelpButton />
        <NotificationCenter />
        <ThemeToggle />
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initials(user?.name)}</AvatarFallback>
          </Avatar>
          <div className="hidden md:block">
            <p className="text-sm font-medium">{user?.name ?? "…"}</p>
            <p className="text-xs text-muted-foreground">{role ? ROLE_LABEL[role] : "Masuk"}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
