"use client";

import { MotionConfig } from "framer-motion";
import { AuthGuard } from "@/components/auth/auth-guard";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { SubscriptionBanner } from "@/components/billing/subscription-banner";
import { LegalLinksFooter } from "@/components/layout/legal-links-footer";
import { usePermissions } from "@/hooks/use-me";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

function CustomerServiceRouteGuard({ children }: { children: React.ReactNode }) {
  const { role, isLoading } = usePermissions();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && role === "cs" && pathname !== "/messages") router.replace("/messages");
  }, [isLoading, pathname, role, router]);
  if (!isLoading && role === "cs" && pathname !== "/messages") return null;
  return <>{children}</>;
}

function CustomerSubscriptionBanner() {
  const { role } = usePermissions();
  return role === "cs" ? null : <SubscriptionBanner />;
}

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
    <AuthGuard>
      <CustomerServiceRouteGuard>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <CustomerSubscriptionBanner />
            <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 py-6 md:p-8 lg:p-10">{children}</main>
            <LegalLinksFooter />
          </div>
        </div>
      </CustomerServiceRouteGuard>
    </AuthGuard>
    </MotionConfig>
  );
}
