import { cn } from "@/lib/utils";

const TONE = "bg-secondary text-secondary-foreground";

/** Stable index from a string, so a contact always gets the same colour. */
export function hashIndex(value: string, modulo: number): number {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % modulo;
}

export function initialsOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? "").trim();
  if (!source) return fallback.replace(/\D/g, "").slice(-2) || "?";
  const parts = source.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export function ContactAvatar({
  name,
  phone,
  className,
}: {
  name?: string | null;
  phone: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        TONE,
        className,
      )}
      aria-hidden
    >
      {initialsOf(name, phone)}
    </div>
  );
}
