import { Check, CheckCheck, Clock, XCircle } from "lucide-react";
import { cn, getMessageStatusConfig } from "@/lib/utils";
import type { MessageStatus } from "@/lib/types";

// Subtle indicator: WhatsApp-style ticks for the delivery path, a plain
// clock/cross for the rest. Text, not a filled pill.
function statusIcon(status: MessageStatus) {
  const cls = "h-3.5 w-3.5";
  switch (status) {
    case "sent":
      return <Check className={cls} />;
    case "delivered":
      return <CheckCheck className={cls} />;
    case "read":
      return <CheckCheck className={cn(cls, "text-primary")} />;
    case "failed":
    case "blocked":
      return <XCircle className={cls} />;
    default:
      return <Clock className={cls} />;
  }
}

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  const config = getMessageStatusConfig(status);
  const problem = status === "failed" || status === "blocked";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        problem ? "font-medium text-destructive" : "text-muted-foreground",
      )}
    >
      {statusIcon(status)}
      {config.label}
    </span>
  );
}
