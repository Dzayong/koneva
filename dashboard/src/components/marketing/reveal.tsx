"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

export type RevealFrom = "up" | "left" | "right" | "pop" | "fade";

// Long ease-out (the "expo-out" family used by Stripe/Linear): fast start, soft landing.
const EASE = [0.22, 1, 0.36, 1] as const;

const hidden: Record<RevealFrom, { opacity: number; x?: number; y?: number; scale?: number; filter?: string }> = {
  up: { opacity: 0, y: 28 },
  left: { opacity: 0, x: -48 },
  right: { opacity: 0, x: 48 },
  pop: { opacity: 0, scale: 0.92, y: 12 },
  fade: { opacity: 0 },
};

function variants(from: RevealFrom, delay: number, reduce: boolean): Variants {
  return {
    hidden: reduce ? { opacity: 0 } : hidden[from],
    show: { opacity: 1, x: 0, y: 0, scale: 1, transition: { duration: reduce ? 0.3 : 0.75, delay, ease: EASE } },
  };
}

/** Scroll-triggered entrance, once. Reduced motion keeps a plain fade and drops all travel. */
export function Reveal({ from = "up", delay = 0, className, children, as = "div" }: {
  from?: RevealFrom; delay?: number; className?: string; children: React.ReactNode; as?: "div" | "li" | "figure" | "section";
}) {
  const reduce = useReducedMotion() ?? false;
  const Tag = motion[as];
  return (
    <Tag initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -12% 0px" }} variants={variants(from, delay, reduce)} className={cn(className)}>
      {children}
    </Tag>
  );
}

/** Children reveal one after another; pass `from` alternating for a zig-zag. */
export function Stagger({ className, children, step = 0.08 }: { className?: string; children: React.ReactNode; step?: number }) {
  return (
    <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -12% 0px" }} transition={{ staggerChildren: step }} className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ from = "up", className, children }: { from?: RevealFrom; className?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  return <motion.div variants={variants(from, 0, reduce)} className={cn(className)}>{children}</motion.div>;
}
