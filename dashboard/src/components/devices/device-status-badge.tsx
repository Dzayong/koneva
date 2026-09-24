import { Badge } from "@/components/ui/badge";
import { cn, getDeviceStatusConfig } from "@/lib/utils";
import type { DeviceStatus } from "@/lib/types";

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const config = getDeviceStatusConfig(status);
  return (
    <Badge variant="secondary" className={cn("gap-1.5", config.bgColor, config.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.color.replace("text-", "bg-"))} />
      {config.label}
    </Badge>
  );
}
