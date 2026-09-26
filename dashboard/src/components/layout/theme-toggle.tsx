"use client";

import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

// Icons swap via the `dark:` variant (CSS), so SSR and first client render
// match regardless of the resolved theme — no hydration flash.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="surface relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border"
    >
      <Sun className="h-5 w-5 scale-100 rotate-0 transition-all duration-300 dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute h-5 w-5 scale-0 rotate-90 transition-all duration-300 dark:scale-100 dark:rotate-0" />
    </motion.button>
  );
}
