import { cn, getDeviceStatusConfig } from "@/lib/utils";
import type { DeviceStatus } from "@/lib/types";

export function StatusDot({ status, className }: { status: DeviceStatus; className?: string }) {
  const dot = getDeviceStatusConfig(status).color.replace("text-", "bg-");
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dot, className)} />;
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const config = getDeviceStatusConfig(status);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <StatusDot status={status} />
      {config.label}
    </span>
  );
}
