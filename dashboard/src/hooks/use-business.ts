"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BusinessUpdate, ProductInput, StatusPost } from "@/lib/types";

export function useStatusPosts(deviceKey: string | undefined) {
  return useQuery({
    queryKey: ["status-posts", deviceKey],
    queryFn: () => api.getStatusPosts(deviceKey!),
    enabled: Boolean(deviceKey),
    refetchInterval: 8_000,
  });
}

export function usePostStatus(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StatusPost) => api.postStatus(deviceKey, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status-posts", deviceKey] }),
  });
}

export function useStatusViewers(deviceKey: string, id: string | null) {
  return useQuery({ queryKey: ["status-viewers", deviceKey, id], queryFn: () => api.getStatusViewers(deviceKey, id!), enabled: Boolean(id) });
}

export function useCancelCommand(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelCommand(deviceKey, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status-posts", deviceKey] }),
  });
}

// The number is asked live, which can take a while: no automatic refetching or retries.
export function useBusiness(deviceKey: string | undefined) {
  return useQuery({ queryKey: ["business", deviceKey], queryFn: () => api.getBusiness(deviceKey!), enabled: Boolean(deviceKey), retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
}

export function useCatalog(deviceKey: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: ["catalog", deviceKey], queryFn: () => api.getCatalog(deviceKey!), enabled: Boolean(deviceKey) && enabled, retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
}

export function useUpdateBusiness(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: BusinessUpdate) => api.updateBusiness(deviceKey, body), onSuccess: () => qc.invalidateQueries({ queryKey: ["business", deviceKey] }) });
}

export function useSaveProduct(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string; body: ProductInput }) => (v.id ? api.updateProduct(deviceKey, v.id, v.body) : api.createProduct(deviceKey, v.body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog", deviceKey] }),
  });
}

export function useDeleteProduct(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteProduct(deviceKey, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog", deviceKey] }) });
}
