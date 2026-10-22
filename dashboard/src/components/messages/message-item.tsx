"use client";

import { messageErrorText } from "@/lib/message-errors";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const canRetry = message.direction === "outbound" && message.status === "failed" && message.error_message !== "delivery_uncertain";
  const retry = useMutation({
    mutationFn: () => api.retryMessage(message.id),
    onSuccess: () => {
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
            onClick={() => {
              if (window.confirm("Kirim ulang pesan ini satu kali? Pastikan pesan memang belum terkirim ke WhatsApp.")) retry.mutate();
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {retry.isPending ? "Memasukkan…" : "Kirim ulang pesan ini"}
          </Button>
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
