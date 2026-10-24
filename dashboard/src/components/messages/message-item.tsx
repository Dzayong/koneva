"use client";

import { messageErrorText } from "@/lib/message-errors";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageStatusBadge } from "@/components/messages/message-status-badge";
import { cn, formatDate, formatPhoneNumber, formatShortRelative } from "@/lib/utils";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";
import type { Message } from "@/lib/types";

export function messageNumber(message: Message): string {
  if (message.chat_jid?.endsWith("@g.us")) return message.chat_jid;
  if (message.to_number.endsWith("@g.us")) return message.to_number;
  return (message.direction === "inbound" ? message.from_number : message.to_number) ?? "";
}

function displayPeer(number: string): string {
  return number.endsWith("@g.us") ? `Grup WhatsApp · ${number}` : formatPhoneNumber(number) || "Tidak dikenal";
}

/** Compact list row; the full message is shown in MessageDetail. */
export function MessageRow({
  message,
  contactName,
  selected,
  onSelect,
}: {
  message: Message;
  contactName?: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  const inbound = message.direction === "inbound";
  const number = messageNumber(message);
  const Arrow = inbound ? ArrowDownLeft : ArrowUpRight;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-accent/60",
          selected && "bg-accent",
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <Arrow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{contactName || displayPeer(number)}</span>
          </p>
          <time
            dateTime={message.created_at}
            title={formatDate(message.created_at)}
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {formatShortRelative(message.created_at)}
          </time>
        </div>
        <p className="line-clamp-2 text-sm">{message.content}</p>
        <MessageStatusBadge status={message.status} errorMessage={message.error_message} />
      </button>
    </li>
  );
}

export function MessageDetail({ message, contactName }: { message: Message; contactName?: string }) {
  const queryClient = useQueryClient();
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const canRetry = message.direction === "outbound" && message.status === "failed" && message.error_message !== "delivery_uncertain";
  const retry = useMutation({
    mutationFn: () => api.retryMessage(message.id),
    onSuccess: () => {
      setRetryDialogOpen(false);
      toast.success("Pesan dipilih masuk antrean kirim ulang");
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error) => toast.error("Pesan tidak bisa dikirim ulang", { description: apiFailure(error).message }),
  });
  const inbound = message.direction === "inbound";
  const number = messageNumber(message);
  const rows: Array<[string, React.ReactNode]> = [
    [inbound ? "Dari" : "Ke", `${contactName ? `${contactName} · ` : ""}${displayPeer(number)}`],
    ["Nomor", <span key="d" className="font-mono text-xs">{message.device_key}</span>],
    ["Status", <MessageStatusBadge key="s" status={message.status} errorMessage={message.error_message} />],
    ["Dibuat", formatDate(message.created_at)],
    ...(message.sent_at ? ([["Terkirim", formatDate(message.sent_at)]] as Array<[string, React.ReactNode]>) : []),
    ...(message.delivered_at ? ([["Sampai", formatDate(message.delivered_at)]] as Array<[string, React.ReactNode]>) : []),
    ...(message.read_at ? ([["Dibaca", formatDate(message.read_at)]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-label">{inbound ? "Pesan masuk" : "Pesan keluar"}</p>
        <p className="mt-3 text-lg leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </div>
      {message.error_message && (
        <p className={cn(
          "rounded-xl border p-3 text-sm",
          message.error_message === "delivery_uncertain"
            ? "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300"
            : "border-destructive/30 bg-destructive/5 text-destructive",
        )}>
          {messageErrorText(message.error_message)}
        </p>
      )}
      {canRetry && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-sm text-muted-foreground">Kirim ulang hanya untuk pesan gagal yang kamu pilih. Pesan ini tidak akan dicoba ulang otomatis.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={retry.isPending}
            onClick={() => setRetryDialogOpen(true)}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {retry.isPending ? "Memasukkan…" : "Kirim ulang pesan ini"}
          </Button>
          <Dialog open={retryDialogOpen} onOpenChange={(open) => !retry.isPending && setRetryDialogOpen(open)}>
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
              <DialogHeader className="border-b px-5 py-4 pr-12">
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <RotateCcw className="h-4 w-4" />
                  </span>
                  Kirim ulang pesan?
                </DialogTitle>
                <DialogDescription>
                  Pesan ini akan dimasukkan kembali ke antrean satu kali setelah kamu konfirmasi.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 px-5 py-4">
                <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                  <p className="text-xs text-muted-foreground">Penerima</p>
                  <p className="mt-1 font-medium">{contactName ? `${contactName} · ` : ""}{displayPeer(number)}</p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">{message.device_key}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">Isi pesan</p>
                  <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm">{message.content}</p>
                </div>
                <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>Pastikan pesan memang belum sampai ke WhatsApp. Jika WhatsApp sudah menerimanya tetapi statusnya belum tercatat, kirim ulang dapat membuat penerima mendapat pesan ganda.</p>
                </div>
              </div>
              <DialogFooter className="px-5 py-4">
                <Button type="button" variant="outline" disabled={retry.isPending} onClick={() => setRetryDialogOpen(false)}>
                  Batal
                </Button>
                <Button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {retry.isPending ? "Memasukkan…" : "Ya, kirim ulang sekali"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <dl className="divide-y rounded-2xl border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
