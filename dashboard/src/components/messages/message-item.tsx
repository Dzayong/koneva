"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { MessageStatusBadge } from "@/components/messages/message-status-badge";
import { cn, formatDate, formatPhoneNumber, formatShortRelative } from "@/lib/utils";
import type { Message } from "@/lib/types";

export function messageNumber(message: Message): string {
  return (message.direction === "inbound" ? message.from_number : message.to_number) ?? "";
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
            <span className="truncate">{contactName || formatPhoneNumber(number) || "Unknown"}</span>
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
        <MessageStatusBadge status={message.status} />
      </button>
    </li>
  );
}

export function MessageDetail({ message, contactName }: { message: Message; contactName?: string }) {
  const inbound = message.direction === "inbound";
  const number = messageNumber(message);
  const rows: Array<[string, React.ReactNode]> = [
    [inbound ? "From" : "To", `${contactName ? `${contactName} · ` : ""}${formatPhoneNumber(number)}`],
    ["Device", <span key="d" className="font-mono text-xs">{message.device_key}</span>],
    ["Status", <MessageStatusBadge key="s" status={message.status} />],
    ["Created", formatDate(message.created_at)],
    ...(message.sent_at ? ([["Sent", formatDate(message.sent_at)]] as Array<[string, React.ReactNode]>) : []),
    ...(message.delivered_at ? ([["Delivered", formatDate(message.delivered_at)]] as Array<[string, React.ReactNode]>) : []),
    ...(message.read_at ? ([["Read", formatDate(message.read_at)]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-label">{inbound ? "Received message" : "Sent message"}</p>
        <p className="mt-3 text-lg leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </div>
      {message.error_message && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {message.error_message}
        </p>
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
