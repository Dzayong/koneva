"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OP } from "@/hooks/use-operator";
import { operatorApi } from "@/lib/operator/api";
import { OperatorApiError } from "@/lib/operator/errors";
import type { SignedIn } from "@/lib/operator/types";

export type AuthStep =
  | { kind: "credentials" }
  | { kind: "mfa"; challengeId: string }
  | { kind: "enroll_code"; challengeId: string }
  | { kind: "enroll_scan"; challengeId: string; secret: string; uri: string }
  /** Recovery codes are shown exactly once; the operator must acknowledge before continuing. */
  | { kind: "recovery"; codes: string[] }
  | { kind: "done" };

/**
 * Sign-in as a state machine: password -> (MFA code | enrollment code -> scan -> first code) -> session.
 * The challenge id lives only in this component's memory (never in storage). Used by the sign-in page and by the
 * re-authentication prompt inside the payment and student dialogs.
 */
export function useOperatorAuthFlow(onSignedIn: () => void) {
  const qc = useQueryClient();
  const [step, setStep] = useState<AuthStep>({ kind: "credentials" });
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const signedInRef = useRef<SignedIn | null>(null);

  const guarded = useCallback(async (work: () => Promise<void>) => {
    if (busy.current) return; // a second click while one is in flight is ignored
    busy.current = true; setPending(true); setError(null);
    try { await work(); }
    catch (e) {
      setError(e);
      // A dead challenge cannot be retried: start again from the password.
      if (e instanceof OperatorApiError && e.code === "MFA_CHALLENGE_INVALID") setStep({ kind: "credentials" });
    } finally { busy.current = false; setPending(false); }
  }, []);

  const complete = useCallback((result: SignedIn) => {
    qc.setQueryData([OP, "me"], result.me);
    if (result.recovery_codes) { signedInRef.current = result; setStep({ kind: "recovery", codes: result.recovery_codes }); return; }
    setStep({ kind: "done" }); onSignedIn();
  }, [qc, onSignedIn]);

  return {
    step, error, pending,
    submitPassword: (email: string, password: string) => guarded(async () => {
      const r = await operatorApi.login(email, password);
      setStep(r.status === "mfa_required" ? { kind: "mfa", challengeId: r.challengeId } : { kind: "enroll_code", challengeId: r.challengeId });
    }),
    submitMfa: (challengeId: string, credential: { code: string } | { recoveryCode: string }) => guarded(async () => complete(await operatorApi.verifyMfa(challengeId, credential))),
    submitEnrollmentCode: (challengeId: string, enrollmentCode: string) => guarded(async () => {
      const s = await operatorApi.startEnrollment(challengeId, enrollmentCode);
      setStep({ kind: "enroll_scan", challengeId, secret: s.secret, uri: s.otpauth_uri });
    }),
    confirmEnrollment: (challengeId: string, code: string) => guarded(async () => complete(await operatorApi.confirmEnrollment(challengeId, code))),
    acknowledgeRecovery: () => { setStep({ kind: "done" }); signedInRef.current = null; onSignedIn(); },
    restart: () => { setError(null); setStep({ kind: "credentials" }); },
  };
}
