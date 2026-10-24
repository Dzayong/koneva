"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KonevaLogo } from "@/components/brand/koneva-logo";
import { LegalLinksFooter } from "@/components/layout/legal-links-footer";
import { AuthFlowPanel } from "@/components/operator/auth-flow-panel";
import { safeNext } from "@/components/operator/operator-shell";

const REASONS: Record<string, string> = {
  expired: "Sesi Anda berakhir. Silakan masuk lagi.",
  required: "Silakan masuk untuk membuka panel.",
  logged_out: "Anda sudah keluar.",
};

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const reason = REASONS[params.get("reason") ?? ""];
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-center"><KonevaLogo markClassName="h-10 w-10" textClassName="text-xl" /></div>
          <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-card">
            <div>
              <h1 className="text-xl font-semibold">Panel Operator</h1>
              <p className="mt-1 text-sm text-muted-foreground">Khusus operator platform. Bukan untuk pelanggan.</p>
            </div>
            {reason && <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">{reason}</p>}
            <AuthFlowPanel onSignedIn={() => router.replace(safeNext(params.get("next")))} />
          </div>
        </div>
      </main>
      <LegalLinksFooter />
    </div>
  );
}

export default function OperatorLoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
