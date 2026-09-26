"use client";

import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";

/** Shows a secret exactly once. It cannot be closed by accident with a stray click outside. */
export function SecretReveal({
  open, title, description, secret, onDone,
  warning = "Salin sekarang. Setelah jendela ini ditutup, kunci tidak bisa ditampilkan lagi. Jika hilang, buat kunci baru.",
  doneLabel = "Saya sudah menyimpannya",
}: { open: boolean; title: string; description: string; secret: string; onDone: () => void; warning?: string; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyText(secret);
    setCopied(ok);
    if (ok) toast.success("Tersalin");
    else toast.error("Tidak bisa menyalin otomatis", { description: "Pilih teksnya lalu salin manual." });
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{warning}</p>
        </div>
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">{secret}</code>
          <Button type="button" variant="outline" onClick={copy} aria-label="Salin">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <Button onClick={onDone} className="w-full">{doneLabel}</Button>
      </DialogContent>
    </Dialog>
  );
}
