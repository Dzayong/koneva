import { Zap } from "lucide-react";

export default function Loading() {
  return (
    <div role="status" aria-label="Memuat" className="flex min-h-screen items-center justify-center">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="loader-ring absolute inset-0 rounded-2xl bg-primary/30" />
        <span className="loader-ring absolute inset-0 rounded-2xl bg-primary/30 [animation-delay:.5s]" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-md">
          <Zap className="h-6 w-6 text-primary-foreground" />
        </div>
      </div>
    </div>
  );
}
