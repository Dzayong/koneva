"use client";

import { ShieldAlert } from "lucide-react";
import { AuthFlowPanel } from "@/components/operator/auth-flow-panel";
import { useOperatorSession } from "@/hooks/use-operator";

/**
 * REAUTH_REQUIRED is answered before any effect, so nothing was changed. Signing in again (password + MFA) refreshes the
 * session; the caller then resubmits the SAME payload with the SAME idempotency key.
 */
export function ReauthPrompt({ onSignedIn }: { onSignedIn: () => void }) {
  const email = useOperatorSession().data?.operator.email;
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium"><ShieldAlert className="h-4 w-4" aria-hidden />Masuk ulang diperlukan</p>
      <p>Aksi ini butuh login yang baru. <strong>Belum ada yang diubah.</strong> Masuk ulang, lalu tindakan dilanjutkan dengan isian yang sama.</p>
      <AuthFlowPanel {...(email ? { fixedEmail: email } : {})} onSignedIn={onSignedIn} />
    </div>
  );
}
