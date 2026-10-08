"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OP } from "@/hooks/use-operator";
import { operatorApi } from "@/lib/operator/api";

export type AuthStep = { kind: "credentials" } | { kind: "done" };

export function useOperatorAuthFlow(onSignedIn: () => void) {
  const qc = useQueryClient();
  const [step, setStep] = useState<AuthStep>({ kind: "credentials" });
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const guarded = useCallback(async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try { await work(); }
    catch (e) { setError(e); }
    finally { busy.current = false; setPending(false); }
  }, []);

  return {
    step, error, pending,
    submitPassword: (email: string, password: string) => guarded(async () => {
      const result = await operatorApi.login(email, password);
      qc.setQueryData([OP, "me"], result.me);
      setStep({ kind: "done" });
      onSignedIn();
    }),
    restart: () => { setError(null); setStep({ kind: "credentials" }); },
  };
}
