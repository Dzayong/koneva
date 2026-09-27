"use client";

import { useCallback, useRef, useState } from "react";
import { IdempotencyGuard } from "@/lib/operator/idempotency";
import { OperatorApiError } from "@/lib/operator/errors";

export type SubmitPhase<R> =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; result: R }
  /** No definite answer (network/5xx). The key is kept: retrying the same payload is safe and never creates a second effect. */
  | { kind: "unknown"; error: OperatorApiError }
  /** A definite 409 (already processed, changed, duplicate...). */
  | { kind: "conflict"; error: OperatorApiError }
  /** Any other definite failure (validation, forbidden, expired session, ...). */
  | { kind: "failed"; error: OperatorApiError };

/**
 * Runs ONE mutation at a time (a second click while one is in flight is ignored, not queued), pairs the payload with an
 * idempotency key, and classifies the outcome. It never reports success before the server answered 2xx.
 */
export function useGuardedSubmit<R>() {
  const guard = useRef(new IdempotencyGuard());
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<SubmitPhase<R>>({ kind: "idle" });

  const run = useCallback(async (payload: unknown, exec: (key: string) => Promise<R>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "submitting" });
    try {
      const result = await exec(guard.current.keyFor(payload));
      setPhase({ kind: "done", result });
    } catch (error) {
      const err = error instanceof OperatorApiError ? error : new OperatorApiError("network", 0, "NETWORK", "No definite answer");
      setPhase(err.outcomeUnknown ? { kind: "unknown", error: err } : err.kind === "conflict" ? { kind: "conflict", error: err } : { kind: "failed", error: err });
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** Back to editing after a DEFINITE answer. The key survives only if the payload stays exactly the same. */
  const backToEdit = useCallback(() => setPhase({ kind: "idle" }), []);
  /** Explicit fresh start (after re-reading the record). This is the only place a key is discarded on purpose. */
  const reset = useCallback(() => { guard.current.reset(); setPhase({ kind: "idle" }); }, []);
  const holdsKey = useCallback((payload: unknown) => guard.current.holds(payload), []);

  return { phase, run, backToEdit, reset, holdsKey };
}
