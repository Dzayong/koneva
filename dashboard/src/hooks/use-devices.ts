import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DEVICES_REFETCH_INTERVAL_MS } from "@/lib/constants";
import type { CreateDeviceRequest, Device } from "@/lib/types";

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => api.getDevices(),
    refetchInterval: DEVICES_REFETCH_INTERVAL_MS,
  });
}

export function usePauseDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceKey: string) => api.pauseDevice(deviceKey),
    onSuccess: (device: Device) => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", device.device_key] });
      toast.success("Nomor dijeda");
    },
    onError: () => toast.error("Gagal menjeda nomor"),
  });
}

export function useResumeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceKey: string) => api.resumeDevice(deviceKey),
    onSuccess: (device: Device) => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", device.device_key] });
      toast.success("Nomor dilanjutkan");
    },
    onError: () => toast.error("Gagal melanjutkan nomor"),
  });
}

export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDeviceRequest) => api.createDevice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Nomor dibuat", { description: "Pindai kode QR untuk menyambungkannya." });
    },
    // Error is rendered inline in the form (with the server's message).
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceKey: string) => api.deleteDevice(deviceKey),
    onSuccess: (_, deviceKey) => {
      // Drop the detail cache first: invalidating the ["devices"] prefix would refetch it and 404.
      queryClient.removeQueries({ queryKey: ["devices", deviceKey] });
      queryClient.invalidateQueries({ queryKey: ["devices"], exact: true });
      toast.success("Nomor dihapus");
    },
    onError: () => toast.error("Gagal menghapus nomor"),
  });
}
