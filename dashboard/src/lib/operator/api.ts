import { operatorClient } from "./client";
import { OperatorApiError } from "./errors";
import {
  parseAudit, parseOtpAlerts, parseConfirmResult, parseDecisionResult, parseEnrollmentSecret, parseInvoiceDetail, parseInvoiceSummary, parseMe, parsePagination, parseSignedIn,
  parseStudentDetail, parseStudentSummary, parseWorkspace,
  type AuditEntry, type OtpAlerts, type EnrollmentSecret, type SignedIn, type ConfirmPaymentInput, type ConfirmPaymentResult, type DecisionInput, type DecisionResult, type InvoiceDetail,
  type InvoiceSummary, type InvoiceStatus, type OperatorMe, type Page, type StudentRequestDetail, type StudentRequestSummary,
  type StudentStatus, type WorkspaceDetail,
} from "./types";

/** Every path below is part of the PROPOSED contract (dashboard/docs/operator-panel-contract.md). */

export const PAGE_SIZE = 25;

function page<T>(res: { data: unknown; pagination?: unknown } | undefined, parse: (v: unknown) => T): Page<T> {
  const items = Array.isArray(res?.data) ? (res.data as unknown[]).map(parse) : [];
  return { items, pagination: parsePagination(res?.pagination, PAGE_SIZE) };
}

/** Step 1 never yields a session: the password only earns a short-lived challenge that MFA must complete. */
export type LoginOutcome = { status: "mfa_required" | "mfa_enrollment_required"; challengeId: string };

function signedIn(res: { data: unknown } | undefined): SignedIn {
  const result = parseSignedIn(res?.data);
  operatorClient.setCsrf(result.me.csrf_token || null);
  return result;
}

export const operatorApi = {
  async login(email: string, password: string): Promise<LoginOutcome> {
    const res = await operatorClient.request<Record<string, unknown>>("/auth/login", { method: "POST", body: { email, password }, effectful: false });
    const data = res?.data as { status?: string; challenge_id?: string } | undefined;
    if ((data?.status === "mfa_required" || data?.status === "mfa_enrollment_required") && typeof data.challenge_id === "string") {
      return { status: data.status, challengeId: data.challenge_id };
    }
    throw new OperatorApiError("server", 200, "BAD_RESPONSE", "Unexpected sign-in response");
  },
  async verifyMfa(challengeId: string, credential: { code: string } | { recoveryCode: string }): Promise<SignedIn> {
    const body = "code" in credential ? { challenge_id: challengeId, code: credential.code } : { challenge_id: challengeId, recovery_code: credential.recoveryCode };
    return signedIn(await operatorClient.request("/auth/mfa/verify", { method: "POST", body, effectful: false }));
  },
  async startEnrollment(challengeId: string, enrollmentCode: string): Promise<EnrollmentSecret> {
    return parseEnrollmentSecret((await operatorClient.request("/auth/mfa/enroll/start", { method: "POST", body: { challenge_id: challengeId, enrollment_code: enrollmentCode }, effectful: false }))?.data);
  },
  async confirmEnrollment(challengeId: string, code: string): Promise<SignedIn> {
    return signedIn(await operatorClient.request("/auth/mfa/enroll/confirm", { method: "POST", body: { challenge_id: challengeId, code }, effectful: false }));
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
  async listAudit(params: { action?: string | undefined; targetType?: string | undefined; targetId?: string | undefined; from?: string | undefined; to?: string | undefined; offset?: number | undefined }): Promise<Page<AuditEntry>> {
    return page(await operatorClient.request("/audit", {
      query: { action: params.action, target_type: params.targetType, target_id: params.targetId, from: params.from, to: params.to, limit: PAGE_SIZE, offset: params.offset ?? 0 },
    }), parseAudit);
  },
};
