import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEVICE_REFETCH_INTERVAL_MS } from "@/lib/constants";

export function useDeviceHealth(deviceKey: string) {
  return useQuery({
    queryKey: ["devices", deviceKey, "health"],
    queryFn: () => api.getDeviceHealth(deviceKey),
    refetchInterval: DEVICE_REFETCH_INTERVAL_MS,
    enabled: Boolean(deviceKey),
  });
}
