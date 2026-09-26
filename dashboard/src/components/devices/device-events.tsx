"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useDeviceEvents } from "@/hooks/use-behavior";
import { formatDate } from "@/lib/utils";

const STATUS: Record<string, { label: string; dot: string }> = {
  online: { label: "Tersambung", dot: "bg-green-600" },
  offline: { label: "Terputus", dot: "bg-gray-400" },
  logged_out: { label: "Keluar dari HP", dot: "bg-amber-500" },
  banned: { label: "Ditolak WhatsApp", dot: "bg-red-600" },
  error: { label: "Sesi bermasalah", dot: "bg-orange-500" },
};

const REASON: Record<string, string> = {
  forbidden_403: "WhatsApp menolak akun ini (dugaan diblokir atau dibatasi).",
  logged_out: "Nomor dikeluarkan dari Perangkat tertaut, lewat HP atau oleh WhatsApp. Pindai QR baru untuk menyambung lagi.",
  connection_replaced: "Sesi yang sama dibuka di tempat lain.",
  bad_session: "Data sesi rusak. Sambungkan ulang dengan QR baru.",
  multidevice_mismatch: "Versi multi-perangkat tidak cocok. Sambungkan ulang.",
};

export function DeviceEvents({ deviceKey }: { deviceKey: string }) {
  const { data, isLoading } = useDeviceEvents(deviceKey);
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!data || data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Belum ada perubahan status. Perubahan tersambung, terputus, atau ditolak akan tercatat di sini.</p>;
  }
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {data.map((event) => {
        const s = STATUS[event.status] ?? { label: event.status, dot: "bg-gray-400" };
        const why = event.reason ? (REASON[event.reason] ?? event.reason) : null;
        return (
          <li key={`${event.created_at}-${event.status}`} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.label}</p>
              {why && <p className="text-sm text-muted-foreground">{why}</p>}
            </div>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={event.created_at}>{formatDate(event.created_at)}</time>
          </li>
        );
      })}
    </ol>
  );
}
