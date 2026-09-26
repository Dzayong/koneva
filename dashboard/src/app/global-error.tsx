"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="id">
      <body className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold">WA Gateway mengalami masalah</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            {error.message || "Terjadi kesalahan serius. Coba muat ulang halaman."}
          </p>
          <button
            onClick={reset}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Muat ulang
          </button>
        </div>
      </body>
    </html>
  );
}
