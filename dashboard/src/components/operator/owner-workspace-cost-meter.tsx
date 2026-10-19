"use client";

import { useState } from "react";
import { Activity, Database, HardDrive, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/operator/field-list";
import { useOwnerWorkspaceCostMeter } from "@/hooks/use-operator";

const number = (value: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value);
function bytes(value: number | null): string {
  if (value === null) return "Belum tersedia";
  if (value < 1024) return `${number(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value / 1024, index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${number(amount)} ${units[index]}`;
}
const queueValue = (value: number | null) => value === null ? "—" : number(value);

export function OwnerWorkspaceCostMeter({ workspaceId }: { workspaceId: string }) {
  const [requested, setRequested] = useState(false);
  const query = useOwnerWorkspaceCostMeter(workspaceId, requested);
  const meter = query.data;
  const button = <Button variant="outline" size="sm" onClick={() => {
    if (!requested) setRequested(true);
    else void query.refetch();
  }} disabled={query.isFetching}>
    <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden />
    {query.isFetching ? "Mengukur…" : meter ? "Perbarui estimasi" : "Muat meteran"}
  </Button>;

  return (
    <Card title="Meteran resource workspace">
      <div className="mb-3 flex justify-end">{button}</div>
      <p className="mb-4 text-sm text-muted-foreground">
        Paket {meter?.workspace.planName ?? "workspace"} · data CPU/RAM dan antrean dari 24 jam terakhir; ukuran database adalah estimasi arah.
      </p>
      {!requested && <p className="text-sm text-muted-foreground">Estimasi database dijalankan hanya saat diminta dan tidak memindai isi pesan.</p>}
      {query.isFetching && !meter && <p className="text-sm text-muted-foreground">Mengambil snapshot resource dan sampel database…</p>}
      {Boolean(query.error) && <p role="alert" className="text-sm text-destructive">Meteran gagal dimuat. {query.error instanceof Error ? query.error.message : "Coba lagi."}</p>}
      {meter && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Database className="h-4 w-4" aria-hidden />Database tenant · estimasi</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{bytes(meter.database.estimatedBytes)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Dari {bytes(meter.database.totalDatabaseBytes)} total · confidence {meter.database.confidence}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><HardDrive className="h-4 w-4" aria-hidden />Penyimpanan sesi device</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{bytes(meter.devices.some((device) => device.sessionStorageBytes !== null) ? meter.devices.reduce((sum, device) => sum + (device.sessionStorageBytes ?? 0), 0) : null)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Activity className="h-4 w-4" aria-hidden />Antrean aktif</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{number(meter.devices.reduce((sum, device) => sum + (device.queue.waiting ?? 0) + (device.queue.active ?? 0) + (device.queue.delayed ?? 0), 0))}</p>
            <p className="mt-1 text-xs text-muted-foreground">Menunggu, aktif, dan tertunda</p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>
              <th className="px-3 py-2 font-medium">Device</th><th className="px-3 py-2 font-medium">CPU rata-rata</th>
              <th className="px-3 py-2 font-medium">RAM puncak</th><th className="px-3 py-2 font-medium">Sesi</th>
              <th className="px-3 py-2 font-medium">Menunggu</th><th className="px-3 py-2 font-medium">Gagal / DLQ</th>
            </tr></thead>
            <tbody>{meter.devices.map((device) => <tr key={device.id} className="border-t">
              <td className="px-3 py-2"><span className="font-medium">{device.label}</span><span className="ml-2 text-xs text-muted-foreground">{device.status}</span></td>
              <td className="px-3 py-2 tabular-nums">{device.cpuPercentAvg === null ? "Belum tersedia" : `${number(device.cpuPercentAvg)}%`}</td>
              <td className="px-3 py-2 tabular-nums">{bytes(device.memoryUsageBytesMax)}</td>
              <td className="px-3 py-2 tabular-nums">{bytes(device.sessionStorageBytes)}</td>
              <td className="px-3 py-2 tabular-nums">{queueValue(device.queue.waiting)}</td>
              <td className="px-3 py-2 tabular-nums">{queueValue(device.queue.failed)} / {queueValue(device.queue.deadLetter)}</td>
            </tr>)}</tbody>
          </table>
          {meter.devices.length === 0 && <p className="p-4 text-sm text-muted-foreground">Workspace ini belum memiliki device.</p>}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Dihitung {new Date(meter.measuredAt).toLocaleString("id-ID")}. {meter.database.note} {meter.pricing.note} Nilai ini belum untuk kuota atau penagihan.</p>
      </>}
    </Card>
  );
}
