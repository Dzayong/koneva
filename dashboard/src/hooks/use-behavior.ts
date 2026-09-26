import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";
import type { PresetId } from "@/lib/types";

export function usePresets() {
  return useQuery({ queryKey: ["presets"], queryFn: () => api.getPresets(), staleTime: 3_600_000 });
}

export function useDeviceActivity(deviceKey: string) {
  return useQuery({
    queryKey: ["device-activity", deviceKey],
    queryFn: () => api.getDeviceActivity(deviceKey),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useDeviceEvents(deviceKey: string) {
  return useQuery({
    queryKey: ["device-events", deviceKey],
    queryFn: () => api.getDeviceEvents(deviceKey),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useApplyPreset(deviceKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preset: PresetId) => api.applyPreset(deviceKey, preset),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-activity", deviceKey] });
      toast.success("Pengaturan diterapkan", { description: "Berlaku untuk pengiriman berikutnya." });
    },
    onError: (error) => toast.error("Gagal menerapkan", { description: apiFailure(error).message }),
  });
}

export function useUpdatePersona(deviceKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Record<string, number | boolean>>) => api.updatePersona(deviceKey, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-activity", deviceKey] });
      toast.success("Pengaturan disimpan");
    },
    onError: (error) => toast.error("Gagal menyimpan", { description: apiFailure(error).message }),
  });
}
