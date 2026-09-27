"use client";

import { AlertTriangle, Inbox, Loader2, Lock, PlugZap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperatorApiError, operatorErrorText } from "@/lib/operator/errors";

export function LoadingBlock({ label = "Memuat…" }: { label?: string }) {
  return <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label}</p>;
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-md text-sm text-muted-foreground">{text}</p>}
    </div>
  );
}

export function ForbiddenState({ text = "Akun operator Anda tidak punya izin untuk membuka bagian ini." }: { text?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border py-14 text-center">
      <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">Akses ditolak</p>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/** One place that turns any operator API failure into the right screen: forbidden, unavailable, or a retryable error. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof OperatorApiError && (error.kind === "forbidden" || error.code === "NOT_OPERATOR")) return <ForbiddenState />;
  const unavailable = error instanceof OperatorApiError && error.kind === "unavailable";
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center">
      {unavailable ? <PlugZap className="h-6 w-6 text-muted-foreground" aria-hidden /> : <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />}
      <p className="max-w-md text-sm">{operatorErrorText(error)}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="mr-1.5 h-4 w-4" />Coba lagi</Button>}
    </div>
  );
}
