"use client";

import { motion, useReducedMotion } from "framer-motion";

// template.tsx remounts on every navigation, so this gives each page an enter
// animation (exit animations aren't possible with App Router).
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
