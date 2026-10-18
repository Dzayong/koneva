import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MESSAGES_REFETCH_INTERVAL_MS } from "@/lib/constants";
import type { MessageListParams } from "@/lib/types";

export function useMessages(params: MessageListParams) {
  return useQuery({
    queryKey: ["messages", params],
    queryFn: () => api.getMessages(params),
    refetchInterval: MESSAGES_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api.getDashboardStats(),
    refetchInterval: MESSAGES_REFETCH_INTERVAL_MS,
  });
}
