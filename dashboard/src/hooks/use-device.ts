import { isAxiosError } from "axios";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEVICE_REFETCH_INTERVAL_MS, QR_REFETCH_INTERVAL_MS } from "@/lib/constants";

export function useDevice(deviceKey: string) {
  return useQuery({
    queryKey: ["devices", deviceKey],
    queryFn: () => api.getDevice(deviceKey),
    refetchInterval: (query) => query.state.data?.history_sync_status === "syncing" ? 2_500 : DEVICE_REFETCH_INTERVAL_MS,
    enabled: Boolean(deviceKey),
  });
}

export function useDeviceQR(deviceKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ["devices", deviceKey, "qr"],
    // 409 QR_NOT_AVAILABLE is the normal "not generated yet / already connected"
    // answer, not a failure: resolve to null and keep polling.
    queryFn: async () => {
      try {
        return await api.getDeviceQR(deviceKey);
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409) return null;
        throw error;
      }
    },
    refetchInterval: enabled ? QR_REFETCH_INTERVAL_MS : false,
    retry: false,
    enabled,
  });
}
