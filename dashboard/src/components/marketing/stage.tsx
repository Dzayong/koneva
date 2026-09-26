"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring } from "framer-motion";

/**
 * Page-level backdrop that fades to the colour of whichever [data-tone] section is centred in the
 * viewport, plus a scroll progress bar. Sections stay transparent; their tone class supplies --stage.
 */
export function Stage({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState("#0a1224");
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.3 });

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const c = getComputedStyle(e.target).getPropertyValue("--stage").trim();
          if (c) setColor(c);
        }
      },
      // A thin band across the middle of the viewport: the section under it is "current".
      { rootMargin: "-45% 0px -50% 0px" },
    );
    // Sections can mount late (pricing waits for the plans request); observing twice is a no-op.
    const observeAll = () => root.current?.querySelectorAll<HTMLElement>("[data-tone]").forEach((s) => observer.observe(s));
    observeAll();
    const mutations = new MutationObserver(observeAll);
    if (root.current) mutations.observe(root.current, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, []);

  return (
    <div ref={root}>
      <div aria-hidden className="fixed inset-0 -z-10 transition-colors duration-700 ease-out" style={{ backgroundColor: color }} />
      <motion.div aria-hidden style={{ scaleX: progress }} className="fixed top-0 right-0 left-0 z-50 h-1 origin-left bg-gradient-to-r from-[#2563eb] via-[#06b6d4] to-[#ff7a45]" />
      {children}
    </div>
  );
}
