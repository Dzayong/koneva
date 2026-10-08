import { operatorClient } from "./client";
import {
  parseAudit, parseOtpAlerts, parseOwnerInsights, parseOwnerDeviceSummary, parseOwnerDeviceDetail, parseOwnerSystemHealth, parseOwnerWorkspaceSummary, parseOwnerWorkspaceDetailData,
  parseConfirmResult, parseDecisionResult, parseInvoiceDetail, parseInvoiceSummary, parseMe, parsePagination, parseSignedIn,
  parseStudentDetail, parseStudentSummary, parseWorkspace,
  type AuditEntry, type OtpAlerts, type SignedIn, type ConfirmPaymentInput, type ConfirmPaymentResult, type DecisionInput, type DecisionResult, type InvoiceDetail,
  type InvoiceSummary, type InvoiceStatus, type OperatorMe, type OwnerInsights, type OwnerDeviceSummary, type OwnerDeviceDetail, type OwnerSystemHealth,
  type OwnerWorkspaceSummary, type OwnerWorkspaceDetailData, type Page, type StudentRequestDetail, type StudentRequestSummary,
  type StudentStatus, type WorkspaceDetail,
} from "./types";

/** Every path below is part of the PROPOSED contract (dashboard/docs/operator-panel-contract.md). */

export const PAGE_SIZE = 25;
export const OWNER_PAGE_SIZE = 10;

function page<T>(res: { data: unknown; pagination?: unknown } | undefined, parse: (v: unknown) => T): Page<T> {
  const items = Array.isArray(res?.data) ? (res.data as unknown[]).map(parse) : [];
  return { items, pagination: parsePagination(res?.pagination, PAGE_SIZE) };
}

function signedIn(res: { data: unknown } | undefined): SignedIn {
  const result = parseSignedIn(res?.data);
  operatorClient.setCsrf(result.me.csrf_token || null);
  return result;
}

export const operatorApi = {
  async login(email: string, password: string): Promise<SignedIn> {
    return signedIn(await operatorClient.request("/auth/login", { method: "POST", body: { email, password }, effectful: false }));
  },

  async me(): Promise<OperatorMe> {
    const res = await operatorClient.request("/me");
    const me = parseMe(res?.data);
    operatorClient.setCsrf(me.csrf_token || null);
    return me;
  },

  async logout(): Promise<void> {
    try { await operatorClient.request("/auth/logout", { method: "POST" }); } finally { operatorClient.setCsrf(null); }
  },

  async listInvoices(params: { status?: InvoiceStatus | undefined; q?: string | undefined; offset?: number | undefined }): Promise<Page<InvoiceSummary>> {
    return page(await operatorClient.request("/invoices", { query: { status: params.status, q: params.q, limit: PAGE_SIZE, offset: params.offset ?? 0 } }), parseInvoiceSummary);
  },
  async getInvoice(id: string): Promise<InvoiceDetail> {
    return parseInvoiceDetail((await operatorClient.request(`/invoices/${encodeURIComponent(id)}`))?.data);
  },
  async confirmPayment(id: string, input: ConfirmPaymentInput, idempotencyKey: string): Promise<ConfirmPaymentResult> {
    return parseConfirmResult((await operatorClient.request(`/invoices/${encodeURIComponent(id)}/confirm-payment`, { method: "POST", body: input, idempotencyKey }))?.data);
  },

  async listStudentRequests(params: { status?: StudentStatus | undefined; q?: string | undefined; offset?: number | undefined }): Promise<Page<StudentRequestSummary>> {
    return page(await operatorClient.request("/student-requests", { query: { status: params.status, q: params.q, limit: PAGE_SIZE, offset: params.offset ?? 0 } }), parseStudentSummary);
  },
  async getStudentRequest(id: string): Promise<StudentRequestDetail> {
    return parseStudentDetail((await operatorClient.request(`/student-requests/${encodeURIComponent(id)}`))?.data);
  },
  async decideStudentRequest(id: string, input: DecisionInput, idempotencyKey: string): Promise<DecisionResult> {
    return parseDecisionResult((await operatorClient.request(`/student-requests/${encodeURIComponent(id)}/decision`, { method: "POST", body: input, idempotencyKey }))?.data);
  },

  async getWorkspace(id: string): Promise<WorkspaceDetail> {
    return parseWorkspace((await operatorClient.request(`/workspaces/${encodeURIComponent(id)}`))?.data);
  },

  async getOtpAlerts(): Promise<OtpAlerts> {
    return parseOtpAlerts((await operatorClient.request("/alerts/otp"))?.data);
  },
  async getOwnerInsights(): Promise<OwnerInsights> {
    return parseOwnerInsights((await operatorClient.request("/insights"))?.data);
  },
  async listOwnerDevices(params: { limit?: number; offset?: number; status?: string; workspace?: string; sort?: string; since?: string; attention?: boolean }): Promise<Page<OwnerDeviceSummary>> {
    return page(await operatorClient.request("/insights/devices", { query: { limit: params.limit ?? OWNER_PAGE_SIZE, offset: params.offset ?? 0, status: params.status, workspace: params.workspace, sort: params.sort, since: params.since, attention: params.attention ? "1" : undefined } }), parseOwnerDeviceSummary);
  },
  async getOwnerDevice(id: string): Promise<OwnerDeviceDetail> {
    return parseOwnerDeviceDetail((await operatorClient.request(`/insights/devices/${encodeURIComponent(id)}`))?.data);
  },
  async getSystemHealth(): Promise<OwnerSystemHealth> {
    return parseOwnerSystemHealth((await operatorClient.request("/insights/health"))?.data);
  },
  async listOwnerWorkspaces(params: { q?: string; limit?: number; offset?: number; plan?: string; status?: string }): Promise<Page<OwnerWorkspaceSummary>> {
    return page(await operatorClient.request("/insights/workspaces", { query: { q: params.q, limit: params.limit ?? OWNER_PAGE_SIZE, offset: params.offset ?? 0, plan: params.plan, status: params.status } }), parseOwnerWorkspaceSummary);
  },
  async getOwnerWorkspace(id: string): Promise<OwnerWorkspaceDetailData> {
    return parseOwnerWorkspaceDetailData((await operatorClient.request(`/insights/workspaces/${encodeURIComponent(id)}`))?.data);
  },
  async listAudit(params: { action?: string | undefined; targetType?: string | undefined; targetId?: string | undefined; from?: string | undefined; to?: string | undefined; offset?: number | undefined }): Promise<Page<AuditEntry>> {
    return page(await operatorClient.request("/audit", {
      query: { action: params.action, target_type: params.targetType, target_id: params.targetId, from: params.from, to: params.to, limit: PAGE_SIZE, offset: params.offset ?? 0 },
    }), parseAudit);
  },
};
