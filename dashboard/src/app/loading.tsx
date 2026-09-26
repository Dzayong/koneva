import { KonevaMark } from "@/components/brand/koneva-logo";

export default function Loading() {
  return (
    <div role="status" aria-label="Memuat" className="flex min-h-screen items-center justify-center">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="loader-ring absolute inset-0 rounded-2xl bg-primary/30" />
        <span className="loader-ring absolute inset-0 rounded-2xl bg-primary/30 [animation-delay:.5s]" />
        <KonevaMark className="relative h-14 w-14 shadow-md" />
      </div>
    </div>
  );
}
