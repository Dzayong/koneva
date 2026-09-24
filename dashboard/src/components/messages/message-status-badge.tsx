import { Badge } from "@/components/ui/badge";
import { cn, getMessageStatusConfig } from "@/lib/utils";
import type { MessageStatus } from "@/lib/types";

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  const config = getMessageStatusConfig(status);
  return (
    <Badge variant="secondary" className={cn("gap-1.5", config.bgColor, config.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.color.replace("text-", "bg-"))} />
      {config.label}
    </Badge>
  );
}
