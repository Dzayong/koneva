"use client";

import { useState } from "react";
import { Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import { NotificationCenter } from "./notification-center";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/devices": "Devices",
  "/messages": "Messages",
  "/broadcast": "Broadcast",
  "/contacts": "Contacts",
  "/analytics": "Analytics",
  "/settings": "Settings",
};

function pageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/devices/")) return "Device Detail";
  return "WA Gateway";
}

export function Header() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <h1 className="text-xl font-semibold">{pageTitle(pathname)}</h1>
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        <Badge variant="outline" className="hidden gap-1 sm:flex">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Connected
        </Badge>
        <NotificationCenter />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-5 w-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-5 w-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        </Button>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>WA</AvatarFallback>
          </Avatar>
          <div className="hidden md:block">
            <p className="text-sm font-medium">Tenant</p>
            <p className="text-xs text-muted-foreground">Signed in</p>
          </div>
        </div>
      </div>
    </header>
  );
}
