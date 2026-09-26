"use client";

import { MotionConfig } from "framer-motion";
import { AuthGuard } from "@/components/auth/auth-guard";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { SubscriptionBanner } from "@/components/billing/subscription-banner";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <SubscriptionBanner />
          <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 py-6 md:p-8 lg:p-10">{children}</main>
        </div>
      </div>
    </AuthGuard>
    </MotionConfig>
  );
}
