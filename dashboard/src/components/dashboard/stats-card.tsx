"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** One bordered strip; StatsCard cells inside are separated by hairlines. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-2xl border bg-card shadow-card lg:grid-cols-4",
        "[&>*]:border-b [&>*]:border-r [&>*:nth-child(2n)]:border-r-0 lg:[&>*:nth-child(2n)]:border-r lg:[&>*:nth-child(4n)]:border-r-0 lg:[&>*]:border-b-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatsCard({
  title,
  value,
  icon: Icon,
  description,
  isLoading,
  index = 0,
}: {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  description?: string;
  isLoading?: boolean;
  index?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: reduceMotion ? 0 : index * 0.04, duration: reduceMotion ? 0 : 0.2 }}
      className="p-5 md:p-6"
    >
      <div className="flex items-center justify-between">
        <p className="text-label">{title}</p>
        {Icon && <Icon className="h-[18px] w-[18px] text-primary" />}
      </div>
      {isLoading ? (
        <Skeleton className="mt-4 h-12 w-24" />
      ) : (
        <p className="text-figure mt-3">{value}</p>
      )}
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </motion.div>
  );
}
