import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEVICE_REFETCH_INTERVAL_MS, QR_REFETCH_INTERVAL_MS } from "@/lib/constants";

export function useDevice(deviceKey: string) {
  return useQuery({
    queryKey: ["devices", deviceKey],
    queryFn: () => api.getDevice(deviceKey),
    refetchInterval: DEVICE_REFETCH_INTERVAL_MS,
    enabled: Boolean(deviceKey),
  });
}

export function useDeviceQR(deviceKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ["devices", deviceKey, "qr"],
    queryFn: () => api.getDeviceQR(deviceKey),
    refetchInterval: enabled ? QR_REFETCH_INTERVAL_MS : false,
    enabled,
  });
}
