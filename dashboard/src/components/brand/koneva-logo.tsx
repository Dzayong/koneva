import { cn } from "@/lib/utils";

/**
 * KONEVA mark: a "K" drawn as a small network. A stem (the business) reaches two nodes (its customers)
 * through one hub. Built from lines and circles only, so it stays crisp from favicon to invoice.
 * Replace with the final artwork by editing this file; every screen uses these two components.
 */
export function KonevaMark({ className, title = "KONEVA" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label={title} className={className} fill="none">
      <rect width="48" height="48" rx="12" fill="url(#koneva-tile)" />
      <path d="M15.5 11.5v25M15.5 24 33 11.5M15.5 24 33 36.5" stroke="#fff" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="33" cy="11.5" r="4.3" fill="#22d3ee" stroke="#0b1f4d" strokeWidth="1.6" />
      <circle cx="33" cy="36.5" r="4.3" fill="#22d3ee" stroke="#0b1f4d" strokeWidth="1.6" />
      <circle cx="15.5" cy="24" r="3.4" fill="#fff" stroke="#0b1f4d" strokeWidth="1.4" />
      <defs>
        <linearGradient id="koneva-tile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f2d6e" />
          <stop offset="1" stopColor="#0a1a3f" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Mark plus wordmark. The wordmark is uppercase with wide tracking, in the interface font. */
export function KonevaLogo({ className, markClassName = "h-9 w-9", textClassName }: { className?: string; markClassName?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <KonevaMark className={cn("shrink-0", markClassName)} />
      <span className={cn("text-lg font-bold tracking-[0.16em] whitespace-nowrap", textClassName)}>KONEVA</span>
    </span>
  );
}
