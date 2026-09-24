import { Progress } from "@/components/ui/progress";
import { cn, getHealthConfig } from "@/lib/utils";

export function HealthBar({ score, className }: { score: number; className?: string }) {
  const config = getHealthConfig(score);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress
        value={score}
        className={cn("w-20", `[&>[data-slot=progress-indicator]]:${config.barColor}`)}
      />
      <span className={cn("text-sm font-medium", config.color)}>{score}</span>
    </div>
  );
}
