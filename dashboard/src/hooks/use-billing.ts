"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BillingCycle } from "@/lib/types";
import { usePermissions } from "@/hooks/use-me";

export function useBilling() {
  const { can } = usePermissions();
  return useQuery({ queryKey: ["billing"], queryFn: () => api.getBilling(), enabled: can("billing:manage"), staleTime: 30_000 });
}

export function usePublicPlans() {
  return useQuery({ queryKey: ["public-plans"], queryFn: () => api.getPublicPlans(), staleTime: 300_000, retry: false });
}

export function usePublicInfo() {
  return useQuery({ queryKey: ["public-info"], queryFn: () => api.getPublicInfo(), staleTime: 300_000, retry: false });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { plan: string; cycle: BillingCycle }) => api.createOrder(v.plan, v.cycle),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

export function useStudentRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.requestStudentVerification(note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

export function useDokuCheckout() {
  return useMutation({ mutationFn: () => api.createDokuCheckout() });
}

export function usePaygTopupCheckout() {
  return useMutation({ mutationFn: (amountIdr: number) => api.createPaygTopupCheckout(amountIdr) });
}

export function useUsageHistory(filters: import("@/lib/types").UsageHistoryFilters) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["usage-history", filters],
    queryFn: () => api.getUsageHistory(filters),
    enabled: can("billing:manage"),
    staleTime: 15_000,
  });
}

export function useUsageDevices() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["usage-devices"],
    queryFn: () => api.getUsageDevices(),
    enabled: can("billing:manage"),
    staleTime: 60_000,
  });
}

export function useUsageDeviceSummary(filters: { date_from?: string; date_to?: string } = {}) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["usage-device-summary", filters],
    queryFn: () => api.getUsageDeviceSummary(filters),
    enabled: can("billing:manage"),
    staleTime: 30_000,
  });
}
