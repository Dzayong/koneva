"use client";

import { useEffect } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operatorApi } from "@/lib/operator/api";
import { operatorClient } from "@/lib/operator/client";
import { OperatorApiError } from "@/lib/operator/errors";
import type { CloseOwnerWorkspaceInput, ConfirmPaymentInput, DecisionInput, InvoiceStatus, OperatorPermission, StudentStatus } from "@/lib/operator/types";

export const OP = "operator" as const;

/** Never retry on an answer the server gave on purpose (auth, forbidden, conflict, validation, missing). */
const retryTransient = (count: number, error: unknown): boolean => !(error instanceof OperatorApiError) || (error.kind === "network" && count < 1);

export function useOperatorSession() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: [OP, "me"], queryFn: () => operatorApi.me(), retry: retryTransient, staleTime: 60_000, refetchOnWindowFocus: true });
  // Any operator request that discovers the session is gone drops operator data only; tenant state is never touched.
  useEffect(() => operatorClient.onSessionLost(() => { qc.removeQueries({ queryKey: [OP] }); }), [qc]);
  const can = (permission: OperatorPermission): boolean => Boolean(query.data?.permissions.includes(permission));
  return { ...query, can };
}

export function useOperatorLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => operatorApi.logout(), onSettled: () => { qc.removeQueries({ queryKey: [OP] }); } });
}

export function useInvoices(params: { status?: InvoiceStatus | undefined; q?: string | undefined; offset?: number | undefined }) {
  return useQuery({ queryKey: [OP, "invoices", params], queryFn: () => operatorApi.listInvoices(params), retry: retryTransient, placeholderData: keepPreviousData });
}
export function useInvoice(id: string) {
  return useQuery({ queryKey: [OP, "invoice", id], queryFn: () => operatorApi.getInvoice(id), retry: retryTransient, staleTime: 0, refetchOnMount: "always" });
}
export function useConfirmPayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { input: ConfirmPaymentInput; key: string }) => operatorApi.confirmPayment(id, v.input, v.key),
    // Only a 2xx reaches here; the UI never shows success before the server confirmed it.
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [OP, "invoice", id] }); void qc.invalidateQueries({ queryKey: [OP, "invoices"] }); void qc.invalidateQueries({ queryKey: [OP, "audit"] }); },
  });
}

export function useStudentRequests(params: { status?: StudentStatus | undefined; q?: string | undefined; offset?: number | undefined }) {
  return useQuery({ queryKey: [OP, "students", params], queryFn: () => operatorApi.listStudentRequests(params), retry: retryTransient, placeholderData: keepPreviousData });
}
export function useStudentRequest(id: string) {
  return useQuery({ queryKey: [OP, "student", id], queryFn: () => operatorApi.getStudentRequest(id), retry: retryTransient, staleTime: 0, refetchOnMount: "always" });
}
export function useDecideStudent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { input: DecisionInput; key: string }) => operatorApi.decideStudentRequest(id, v.input, v.key),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [OP, "student", id] }); void qc.invalidateQueries({ queryKey: [OP, "students"] }); void qc.invalidateQueries({ queryKey: [OP, "audit"] }); },
  });
}

export function useWorkspace(id: string) {
  return useQuery({ queryKey: [OP, "workspace", id], queryFn: () => operatorApi.getWorkspace(id), retry: retryTransient });
}

export function useAudit(params: { action?: string | undefined; targetType?: string | undefined; targetId?: string | undefined; from?: string | undefined; to?: string | undefined; offset?: number | undefined }) {
  return useQuery({ queryKey: [OP, "audit", params], queryFn: () => operatorApi.listAudit(params), retry: retryTransient, placeholderData: keepPreviousData });
}

/** OTP sender-budget alerts. Always re-read on mount: an alert is only useful if it is current, and it is never pushed anywhere. */
export function useOtpAlerts(enabled = true) {
  return useQuery({ queryKey: [OP, "otp-alerts"], queryFn: () => operatorApi.getOtpAlerts(), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always" });
}

/** Owner data is fetched only for an owner with the explicit insights permission. The server enforces it again. */
export function useOwnerInsights(enabled = true) {
  return useQuery({ queryKey: [OP, "owner-insights"], queryFn: () => operatorApi.getOwnerInsights(), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always", refetchInterval: 60_000 });
}

export function useOwnerDevices(params: { limit?: number; offset?: number; status?: string; workspace?: string; sort?: string; since?: string; attention?: boolean }, enabled = true) {
  return useQuery({ queryKey: [OP, "owner-devices", params], queryFn: () => operatorApi.listOwnerDevices(params), enabled, retry: retryTransient, placeholderData: keepPreviousData, refetchInterval: 60_000 });
}
export function useOwnerDevice(id: string, enabled = true) {
  return useQuery({ queryKey: [OP, "owner-device", id], queryFn: () => operatorApi.getOwnerDevice(id), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always", refetchInterval: 60_000 });
}
export function useSystemHealth(enabled = true) {
  return useQuery({ queryKey: [OP, "system-health"], queryFn: () => operatorApi.getSystemHealth(), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always", refetchInterval: 60_000 });
}
export function useSystemWhatsappOtpSender(enabled = true) {
  return useQuery({ queryKey: [OP, "system-whatsapp-otp-sender"], queryFn: () => operatorApi.getSystemWhatsappOtpSender(), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always", refetchInterval: 3_000 });
}
export function useSystemWhatsappOtpQr() {
  return useMutation({ mutationFn: () => operatorApi.getSystemWhatsappOtpQr() });
}
export function usePairSystemWhatsappOtpSender() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => operatorApi.pairSystemWhatsappOtpSender(), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: [OP, "system-whatsapp-otp-sender"] });
    void qc.invalidateQueries({ queryKey: [OP, "audit"] });
  } });
}
export function useSaveSystemWhatsappNotifications() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: operatorApi.saveSystemWhatsappNotifications, onSuccess: () => {
    void qc.invalidateQueries({ queryKey: [OP, "system-whatsapp-otp-sender"] });
    void qc.invalidateQueries({ queryKey: [OP, "audit"] });
  } });
}
export function useTestSystemWhatsappNotifications() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: operatorApi.testSystemWhatsappNotifications, onSuccess: () => {
    void qc.invalidateQueries({ queryKey: [OP, "system-whatsapp-otp-sender"] });
    void qc.invalidateQueries({ queryKey: [OP, "audit"] });
  } });
}
export function useAiReplySettings(enabled = true) {
  return useQuery({ queryKey: [OP, "ai-reply-settings"], queryFn: () => operatorApi.getAiReplySettings(), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always" });
}
export function useSaveAiReplySettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: operatorApi.saveAiReplySettings, onSuccess: () => {
    void qc.invalidateQueries({ queryKey: [OP, "ai-reply-settings"] });
    void qc.invalidateQueries({ queryKey: [OP, "audit"] });
  } });
}
export function usePaygSettings(enabled = true) {
  return useQuery({ queryKey: [OP, "payg-settings"], queryFn: () => operatorApi.getPaygSettings(), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always" });
}
export function useSavePaygSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: operatorApi.savePaygSettings, onSuccess: () => {
    void qc.invalidateQueries({ queryKey: [OP, "payg-settings"] });
    void qc.invalidateQueries({ queryKey: [OP, "audit"] });
  } });
}
export function useOwnerWorkspaces(params: { q?: string; limit?: number; offset?: number; plan?: string; status?: string }, enabled = true) {
  return useQuery({ queryKey: [OP, "owner-workspaces", params], queryFn: () => operatorApi.listOwnerWorkspaces(params), enabled, retry: retryTransient, placeholderData: keepPreviousData, refetchInterval: 60_000 });
}
export function useOwnerWorkspace(id: string, enabled = true) {
  return useQuery({ queryKey: [OP, "owner-workspace", id], queryFn: () => operatorApi.getOwnerWorkspace(id), enabled, retry: retryTransient, staleTime: 0, refetchOnMount: "always", refetchInterval: 60_000 });
}
/** On-demand estimate; it samples a bounded number of PostgreSQL blocks and is intentionally not polled. */
export function useOwnerWorkspaceCostMeter(id: string, enabled = false) {
  return useQuery({ queryKey: [OP, "owner-workspace-cost-meter", id], queryFn: () => operatorApi.getOwnerWorkspaceCostMeter(id), enabled,
    retry: retryTransient, staleTime: 10 * 60_000, refetchOnWindowFocus: false });
}
export function useCloseOwnerWorkspace(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { input: CloseOwnerWorkspaceInput; key: string }) => operatorApi.closeOwnerWorkspace(id, v.input, v.key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [OP, "owner-workspace", id] });
      void qc.invalidateQueries({ queryKey: [OP, "owner-workspaces"] });
      void qc.invalidateQueries({ queryKey: [OP, "owner-insights"] });
      void qc.invalidateQueries({ queryKey: [OP, "audit"] });
    },
  });
}
