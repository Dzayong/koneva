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
      toast.success("Device paused");
    },
    onError: () => toast.error("Failed to pause device"),
  });
}

export function useResumeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceKey: string) => api.resumeDevice(deviceKey),
    onSuccess: (device: Device) => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["devices", device.device_key] });
      toast.success("Device resumed");
    },
    onError: () => toast.error("Failed to resume device"),
  });
}

export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDeviceRequest) => api.createDevice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Device created", { description: "Scan the QR code to connect it." });
    },
    onError: () => toast.error("Failed to create device"),
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceKey: string) => api.deleteDevice(deviceKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Device deleted");
    },
    onError: () => toast.error("Failed to delete device"),
  });
}
