"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Filters and page live in the URL so a filtered queue can be shared and survives a reload. Empty values are dropped. */
export function useSearchParamsState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // router.replace lands asynchronously; remember what we last wrote until the URL catches up.
  const pending = useRef<string | null>(null);
  const current = params.toString();
  useEffect(() => { pending.current = null; }, [current]);
  const set = useCallback((next: Record<string, string | number | undefined | null>) => {
    // Read the live URL, not the render snapshot: two quick changes (e.g. two date fields) must not overwrite each other.
    const qs = new URLSearchParams(pending.current ?? (typeof window === "undefined" ? params.toString() : window.location.search));
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === null || v === "" || v === 0) qs.delete(k); else qs.set(k, String(v));
    }
    const s = qs.toString();
    pending.current = s;
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, router, pathname]);
  return { params, set };
}
