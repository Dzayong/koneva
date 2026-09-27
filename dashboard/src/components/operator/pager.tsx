"use client";

import { Button } from "@/components/ui/button";
import type { Pagination } from "@/lib/operator/types";

export function Pager({ pagination, onOffset, busy }: { pagination: Pagination; onOffset: (offset: number) => void; busy?: boolean }) {
  const { total, limit, offset } = pagination;
  if (total === 0) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav aria-label="Halaman" className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
      <p className="text-muted-foreground" aria-live="polite">Menampilkan {from}–{to} dari {total}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy || offset <= 0} onClick={() => onOffset(Math.max(0, offset - limit))}>Sebelumnya</Button>
        <Button variant="outline" size="sm" disabled={busy || !pagination.has_more} onClick={() => onOffset(offset + limit)}>Berikutnya</Button>
      </div>
    </nav>
  );
}
