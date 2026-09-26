"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Device } from "@/lib/types";

/** Number picker shared by Status and other device-level screens; only numbers that are online can act, others are shown but disabled. */
export function DeviceSelect({ devices, value, onChange }: { devices: Device[]; value: string | undefined; onChange: (key: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-72" aria-label="Pilih device"><SelectValue placeholder="Pilih device" /></SelectTrigger>
      <SelectContent>
        {devices.map((d) => (
          <SelectItem key={d.device_key} value={d.device_key} disabled={d.status !== "online"}>
            {d.label ?? d.device_key}{d.status !== "online" ? " (tidak online)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
