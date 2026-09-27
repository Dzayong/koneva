"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  src: string;
  /** Which edge the photo hugs; it fades out toward the text side and at the top and bottom. */
  side?: "right" | "left" | "full";
  className?: string;
  /** Extra Tailwind for tone-specific blending, e.g. "mix-blend-multiply". */
  blend?: string;
}

/**
 * Decorative photo that sits behind the copy: masked so it dissolves into the section colour, and
 * drifting slightly slower than the page for depth. It is aria-hidden; nothing informative lives here.
 */
export function PhotoBackdrop({ src, side = "right", className, blend }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 36, reduce ? 0 : -36]);
  const toText = side === "right" ? "to left" : side === "left" ? "to right" : "to bottom";
  const mask = side === "full"
    ? "linear-gradient(to bottom, transparent, #000 30%, #000 65%, transparent)"
    : `linear-gradient(${toText}, #000 25%, transparent 92%), linear-gradient(to bottom, transparent, #000 22%, #000 72%, transparent)`;
  return (
    <div ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 -z-0 overflow-hidden", className)}>
      {/* suppressHydrationWarning: `y` is a scroll-linked MotionValue Framer Motion resolves against the real client scroll
          position and prefers-reduced-motion, neither knowable during SSR; the client's first-paint transform legitimately
          differs from the server's static guess. */}
      <motion.div suppressHydrationWarning style={{ y, WebkitMaskImage: mask, maskImage: mask, maskComposite: "intersect", WebkitMaskComposite: "source-in" }}
        className={cn("absolute inset-y-[-40px] opacity-[0.28] md:opacity-[0.55]", side === "right" && "right-0 w-full md:w-[52%]", side === "left" && "left-0 w-full md:w-[52%]", side === "full" && "inset-x-0", blend)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </motion.div>
    </div>
  );
}
