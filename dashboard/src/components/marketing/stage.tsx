"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";

type RGB = [number, number, number];
const BLEND_PX = 90; // half-width of the colour fade around each section seam; fits inside section padding

function parse(color: string): RGB | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const n = parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: RGB, b: RGB, t: number): string =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(",")})`;

/**
 * Fixed page backdrop whose colour is a continuous function of scroll: as a section seam passes the
 * middle of the viewport the colour eases from one section's tone into the next (no snap), plus a
 * scroll progress bar. Sections stay transparent; each tone class supplies --stage.
 */
export function Stage({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const seams = useRef<Array<{ y: number; from: RGB; to: RGB }>>([]);
  const first = useRef<RGB>([10, 18, 36]);
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.3 });

  const paint = useCallback((scroll: number) => {
    if (!layer.current) return;
    const v = scroll + window.innerHeight * 0.5; // the reading line
    let color = seams.current.length ? seams.current[seams.current.length - 1]!.to : first.current;
    let css: string | undefined;
    for (const s of seams.current) {
      if (v < s.y - BLEND_PX) { color = s.from; break; }
      if (v <= s.y + BLEND_PX) { css = mix(s.from, s.to, smooth((v - (s.y - BLEND_PX)) / (2 * BLEND_PX))); break; }
      color = s.to;
    }
    layer.current.style.backgroundColor = css ?? `rgb(${color.join(",")})`;
  }, []);

  const measure = useCallback(() => {
    const sections = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-tone]") ?? []);
    const colors = sections.map((s) => parse(getComputedStyle(s).getPropertyValue("--stage")));
    const next: typeof seams.current = [];
    sections.forEach((s, i) => {
      const from = colors[i - 1]; const to = colors[i];
      if (i > 0 && from && to) next.push({ y: s.getBoundingClientRect().top + window.scrollY, from, to });
    });
    seams.current = next;
    first.current = colors[0] ?? first.current;
    paint(window.scrollY);
  }, [paint]);

  useEffect(() => {
    measure();
    // Images, the video and late sections (pricing) change heights, so re-measure when the page does.
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    const mo = new MutationObserver(measure);
    // Direct children only: the typing animations mutate deep inside sections many times a second.
    const main = root.current?.querySelector("main");
    if (main) mo.observe(main, { childList: true });
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);

  useMotionValueEvent(scrollY, "change", paint);

  return (
    <div ref={root}>
      <div ref={layer} aria-hidden className="fixed inset-0 -z-10" style={{ backgroundColor: "#0a1224" }} />
      <motion.div aria-hidden style={{ scaleX: progress }} className="fixed top-0 right-0 left-0 z-50 h-1 origin-left bg-gradient-to-r from-[#2563eb] via-[#06b6d4] to-[#ff7a45]" />
      {children}
    </div>
  );
}
