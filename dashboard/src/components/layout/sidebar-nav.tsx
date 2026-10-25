"use client";

import { ROLE_LABEL } from "@/lib/roles";
import { useId } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  CircleDot,
  CreditCard,
  Webhook,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Reply,
  Rocket,
  Settings,
  Smartphone,
  Users,
} from "lucide-react";
import { KonevaMark } from "@/components/brand/koneva-logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-me";
import type { Permission } from "@/lib/types";

interface NavItem { name: string; href: string; icon: typeof LayoutDashboard; permission?: Permission }

// Items a role cannot use are hidden, not greyed out: nobody should be teased with screens they cannot open.
const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "WORKSPACE",
    items: [
      { name: "Ringkasan", href: "/dashboard", icon: LayoutDashboard },
      { name: "Device", href: "/devices", icon: Smartphone, permission: "devices:read" },
      { name: "Kotak masuk", href: "/messages", icon: MessageSquare, permission: "messages:read" },
      { name: "Broadcast", href: "/broadcast", icon: Radio, permission: "messages:send" },
      { name: "Campaign Terjadwal", href: "/campaigns", icon: CalendarClock, permission: "messages:send" },
      { name: "Status", href: "/status", icon: CircleDot, permission: "devices:read" },
      { name: "Kontak", href: "/contacts", icon: Users, permission: "messages:read" },
      { name: "Analitik", href: "/analytics", icon: BarChart3, permission: "messages:read" },
      { name: "Balas otomatis", href: "/settings/auto-reply", icon: Reply, permission: "messages:read" },
    ],
  },
  {
    label: "PENGEMBANG",
    items: [
      { name: "Mulai cepat", href: "/developers/quickstart", icon: Rocket, permission: "messages:send" },
      { name: "Webhook", href: "/developers/webhooks", icon: Webhook, permission: "webhooks:manage" },
      { name: "Kunci API", href: "/developers/keys", icon: KeyRound, permission: "keys:manage" },
    ],
  },
  {
    label: "ADMINISTRASI",
    items: [
      { name: "Tagihan", href: "/billing", icon: CreditCard, permission: "billing:manage" },
      { name: "Aktivitas", href: "/activity", icon: History, permission: "audit:read" },
      { name: "Pengaturan", href: "/settings", icon: Settings, permission: "devices:read" },
    ],
  },
];
const navigation = groups.flatMap((g) => g.items);


export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const { can, role, user, workspace } = usePermissions();
  const navId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-20 shrink-0 items-center gap-3 border-b border-sidebar-border px-6">
        <KonevaMark className="h-9 w-9" />
        <div>
          <span className="text-lg font-bold tracking-[0.16em] text-sidebar-accent-foreground">KONEVA</span>
          <p className="mt-0.5 text-[11px] tracking-wide text-sidebar-foreground">Ruang kerja pesan</p>
        </div>
      </div>

      <nav aria-label="Navigasi utama" className="flex-1 space-y-1 overflow-y-auto p-4">
        {groups.map((group) => {
          if (role === "cs" && group.label !== "WORKSPACE") return null;
          const visible = group.items.filter((item) => (role !== "cs" || item.href === "/messages") &&
            (item.href === "/messages" ? can("messages:read") || can("inbox:read") : (!item.permission || can(item.permission))));
          if (visible.length === 0) return null;
          return (
            <div key={group.label} className="space-y-1">
              <p className="mb-2 px-3 pt-4 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground">{group.label}</p>
              {visible.map((item) => {
                // Longest matching href wins, so /settings/auto-reply doesn't also light up "Pengaturan".
                const isActive =
                  navigation
                    .filter((n) => pathname.startsWith(n.href))
                    .sort((a, b) => b.href.length - a.href.length)[0]?.href === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
                      isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId={reduceMotion ? undefined : `${navId}-active`}
                        className="absolute inset-0 rounded-lg bg-sidebar-accent"
                        transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
                      >
                        <span className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-sidebar-primary" />
                      </motion.span>
                    )}
                    <item.icon className={cn("relative h-[18px] w-[18px]", isActive && "text-sidebar-primary")} />
                    <span className="relative">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="mb-2 px-3">
          <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{user?.name ?? "…"}</p>
          <p className="truncate text-xs text-sidebar-foreground">
            {workspace?.name ?? "…"}{role ? ` · ${ROLE_LABEL[role]}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring"
        >
          <LogOut className="h-5 w-5" />
          Keluar
        </button>
      </div>
    </div>
  );
}
