"use client";

import { useState } from "react";
import {
  Shield,
  Timer,
  Flame,
  Send,
  MessageCircle,
  Ban,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ChevronDown,
  Trophy,
  Target,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeviceHealth } from "@/hooks/use-device-health";
import type { HealthBreakdownItem, HealthBreakdownStatus, HealthMission } from "@/lib/types";

const BREAKDOWN_ICONS: Record<string, React.ReactNode> = {
  age: <Timer className="h-4 w-4" />,
  warmup: <Flame className="h-4 w-4" />,
  delivery: <Send className="h-4 w-4" />,
  reply: <MessageCircle className="h-4 w-4" />,
  block: <Ban className="h-4 w-4" />,
  report: <AlertTriangle className="h-4 w-4" />,
};

const STATUS_STYLES: Record<HealthBreakdownStatus, { ring: string; bg: string; text: string; icon: React.ReactNode }> = {
  complete: {
    ring: "ring-emerald-500/30",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  },
  partial: {
    ring: "ring-amber-400/30",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-400",
    icon: <Target className="h-3.5 w-3.5 text-amber-500" />,
  },
  locked: {
    ring: "ring-slate-300/30 dark:ring-slate-600/30",
    bg: "bg-slate-50 dark:bg-slate-800/40",
    text: "text-slate-500 dark:text-slate-400",
    icon: <Lock className="h-3.5 w-3.5 text-slate-400" />,
  },
  danger: {
    ring: "ring-red-500/30",
    bg: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-400",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
  },
};

function ScoreRing({ score, className }: { score: number; className?: string }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#84cc16" : score >= 40 ? "#f59e0b" : score >= 20 ? "#f97316" : "#ef4444";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width="140" height="140" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/60" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight">{score}</span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function BreakdownRow({ item }: { item: HealthBreakdownItem }) {
  const style = STATUS_STYLES[item.status];
  const pct = item.max > 0 ? Math.max(0, (item.score / item.max) * 100) : 0;

  return (
    <div className={cn("flex items-center gap-3 rounded-xl px-3.5 py-3 ring-1", style.ring, style.bg)}>
      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", style.bg, style.text)}>
        {BREAKDOWN_ICONS[item.id] ?? <Shield className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{item.label}</span>
          <div className="flex items-center gap-1.5">
            {style.icon}
            <span className={cn("text-xs font-semibold tabular-nums", style.text)}>
              {item.score < 0 ? item.score : `+${item.score}`}/{item.max}
            </span>
          </div>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
          <div
            className={cn("h-full rounded-full transition-all duration-700", {
              "bg-emerald-500": item.status === "complete",
              "bg-amber-400": item.status === "partial",
              "bg-slate-300 dark:bg-slate-600": item.status === "locked",
              "bg-red-500": item.status === "danger",
            })}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{item.description}</p>
      </div>
    </div>
  );
}

function MissionCard({ mission, index }: { mission: HealthMission; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "w-full rounded-xl border px-3.5 py-3 text-left transition-colors",
        mission.completed
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/30"
          : "border-border bg-card hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            mission.completed
              ? "bg-emerald-500 text-white"
              : "bg-muted text-muted-foreground",
          )}
        >
          {mission.completed ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <span className={cn("text-sm font-medium", mission.completed && "line-through text-muted-foreground")}>
            {mission.label}
          </span>
          <p className="text-[11px] text-muted-foreground">{mission.description}</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>
      {open && (
        <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Cara:</span> {mission.requirement}
        </div>
      )}
    </button>
  );
}

export function HealthDetail({ deviceKey }: { deviceKey: string }) {
  const { data, isLoading } = useDeviceHealth(deviceKey);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="mx-auto h-36 w-36 rounded-full" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const completedMissions = data.missions.filter((m) => m.completed).length;

  return (
    <div className="space-y-8">
      {/* Score ring */}
      <div className="flex flex-col items-center gap-2">
        <ScoreRing score={data.health_score} />
        <p className="text-sm text-muted-foreground">
          Hari ke-{data.warmup_day} {data.warmup_completed ? "" : "· Warmup aktif"}
        </p>
      </div>

      {/* Breakdown */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-primary" />
          Breakdown Skor
        </h3>
        <div className="space-y-2">
          {data.breakdown.map((item) => (
            <BreakdownRow key={item.id} item={item} />
          ))}
        </div>
      </section>

      {/* Missions */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Trophy className="h-4 w-4 text-amber-500" />
            Misi Kesehatan
          </h3>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="h-3 w-3" />
            {completedMissions}/{data.missions.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {data.missions.map((mission, i) => (
            <MissionCard key={mission.id} mission={mission} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
