import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MESSAGES_REFETCH_INTERVAL_MS } from "@/lib/constants";
import type { InboxConversation, MessageListParams } from "@/lib/types";

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

export function useInboxDevices() {
  return useQuery({ queryKey: ["inbox", "devices"], queryFn: () => api.getInboxDevices(), refetchInterval: MESSAGES_REFETCH_INTERVAL_MS });
}

export function useInboxConversations(params: { device_key?: string; search?: string }) {
  return useQuery({
    queryKey: ["inbox", "conversations", params],
    queryFn: () => api.getInboxConversations({ ...params, limit: 100 }),
    refetchInterval: MESSAGES_REFETCH_INTERVAL_MS,
    select: (response): InboxConversation[] => response.data,
  });
}

export function useInboxMessages(params: { device_key: string; chat_key: string }, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["inbox", "messages", params],
    queryFn: ({ pageParam }) => api.getInboxMessages({ ...params, limit: 100, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => lastPage.pagination.has_more === true ? allPages.length * 100 : undefined,
    enabled,
    refetchInterval: MESSAGES_REFETCH_INTERVAL_MS,
    select: (result) => ({ messages: result.pages.flatMap((page) => page.data).reverse() }),
  });
}
