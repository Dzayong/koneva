import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const ANALYTICS_REFETCH_INTERVAL_MS = 60_000;

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api.getAnalyticsOverview(),
    refetchInterval: ANALYTICS_REFETCH_INTERVAL_MS,
  });
}

export function useAnalyticsDaily(days: number) {
  return useQuery({
    queryKey: ["analytics", "daily", days],
    queryFn: () => api.getAnalyticsDaily(days),
    refetchInterval: ANALYTICS_REFETCH_INTERVAL_MS,
  });
}
