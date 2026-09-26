"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProfileUpdate, StatusPost } from "@/lib/types";

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

// The device is asked live, which can take a while: no automatic refetching or retries.
export function useProfile(deviceKey: string | undefined) {
  return useQuery({ queryKey: ["profile", deviceKey], queryFn: () => api.getProfile(deviceKey!), enabled: Boolean(deviceKey), retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
}

export function useUpdateProfile(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: ProfileUpdate) => api.updateProfile(deviceKey, body), onSuccess: (data) => qc.setQueryData(["profile", deviceKey], data) });
}

export function useSetPicture(deviceKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageBase64: string | null) => (imageBase64 ? api.setProfilePicture(deviceKey, imageBase64) : api.removeProfilePicture(deviceKey)),
    onSuccess: (data) => qc.setQueryData(["profile", deviceKey], data),
  });
}
