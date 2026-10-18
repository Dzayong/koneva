"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { WorkspaceReadiness } from "@/lib/types";

export const workspaceReadinessKey = ["workspace-readiness"] as const;

export function useWorkspaceReadiness() {
  return useQuery({
    queryKey: workspaceReadinessKey,
    queryFn: () => api.getWorkspaceReadiness(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useConfirmWorkspaceMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (missionId: string) => api.confirmWorkspaceMission(missionId),
    onSuccess: (data) => queryClient.setQueryData(workspaceReadinessKey, data),
  });
}

export function useRunWorkspaceTestMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { missionId: string; answer?: string }) => api.runWorkspaceTestMission(input.missionId, input.answer),
    onSuccess: ({ readiness }) => queryClient.setQueryData(workspaceReadinessKey, readiness),
  });
}

export function useBypassWorkspaceLevel() {
  const queryClient = useQueryClient();
  return useMutation<{ readiness: WorkspaceReadiness }, Error, { target_level: number; reason: string; dialog_version: "level-bypass-v1"; idempotency_key: string }>({
    mutationFn: api.bypassWorkspaceLevel.bind(api),
    onSuccess: ({ readiness }) => queryClient.setQueryData(workspaceReadinessKey, readiness),
  });
}
