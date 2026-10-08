"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOperatorAuthFlow } from "@/hooks/use-operator-auth-flow";
import { OperatorApiError, operatorErrorText } from "@/lib/operator/errors";

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const wait = error instanceof OperatorApiError && error.kind === "rate_limited" && error.retryAfterSeconds ? ` Coba lagi dalam ${error.retryAfterSeconds} detik.` : "";
  return <p role="alert" className="text-sm text-destructive">{operatorErrorText(error)}{wait}</p>;
}

function Submit({ pending, disabled, children }: { pending: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <Button type="submit" className="w-full" disabled={pending || disabled}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{children}</Button>;
}

export function AuthFlowPanel({ fixedEmail, onSignedIn }: { fixedEmail?: string; onSignedIn: () => void }) {
  const flow = useOperatorAuthFlow(onSignedIn);
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [password, setPassword] = useState("");
  const { step, pending, error } = flow;

  if (step.kind === "credentials") {
    return (
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void flow.submitPassword(email.trim(), password); }}>
        <div className="space-y-2">
          <Label htmlFor="op-email">Email</Label>
          <Input id="op-email" type="email" autoComplete="username" required value={email} readOnly={Boolean(fixedEmail)} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2"><Label htmlFor="op-password">Kata sandi</Label><Input id="op-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <ErrorLine error={error} />
        <Submit pending={pending} disabled={!email.trim() || !password}>Masuk</Submit>
      </form>
    );
  }

  return <p role="status" className="text-sm text-muted-foreground">Berhasil masuk…</p>;
}
