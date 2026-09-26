import axios, { type AxiosInstance, type AxiosError } from "axios";
import { toast } from "sonner";
import { API_BASE_URL, API_KEY_STORAGE_KEY, SESSION_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "./constants";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Suppress the global error toast — caller renders its own error state instead. */
    skipErrorToast?: boolean;
    /** A 401 is an expected answer (e.g. wrong password): do not clear the session or redirect. */
    skipAuthRedirect?: boolean;
  }
}
import type {
  ApiKeyRecord,
  DeviceCommand,
  DeviceProfile,
  ProfileUpdate,
  StatusPost,
  StatusViewers,
  WebhookLog,
  WebhookSettings,
  WebhookTestResult,
  BillingCycle,
  BillingState,
  Invoice,
  PublicPlan,
  AuditEntry,
  AuthResult,
  CreatedApiKey,
  CreatedInvitation,
  DeviceActivity,
  DeviceEvent,
  InvitationPreview,
  Me,
  PendingInvitation,
  Persona,
  Preset,
  PresetId,
  Role,
  TeamMember,
  AnalyticsDailyPoint,
  AnalyticsOverview,
  ApiErrorBody,
  ContactListParams,
  ContactRecord,
  CreateContactRequest,
  ApiSuccess,
  AutoReplyRule,
  AutoReplyRuleInput,
  CreateDeviceRequest,
  Device,
  DeviceHealthData,
  Message,
  MessageListParams,
  PaginatedResponse,
  QRCodeResponse,
  SendMessageRequest,
  SendMessageResponse,
  Tenant,
} from "./types";

class ApiClient {
  private client: AxiosInstance;
  private apiKey: string | null = null;
  private session: string | null = null;
  private workspaceId: string | null = null;
  private authListeners = new Set<() => void>();

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: { "Content-Type": "application/json" },
    });

    this.client.interceptors.request.use((config) => {
      // A signed-in person takes precedence over the legacy tenant key.
      const session = this.getSession();
      if (session) {
        config.headers.Authorization = `Bearer ${session}`;
        const workspace = this.getWorkspaceId();
        if (workspace) config.headers["x-workspace"] = workspace;
        return config;
      }
      const key = this.getApiKey();
      if (key) {
        config.headers.apikey = key;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiErrorBody>) => {
        const status = error.response?.status;
        const message = error.response?.data?.error?.message;
        const skipToast = error.config?.skipErrorToast === true;

        if (status === 401 && error.config?.skipAuthRedirect === true) {
          // Expected (wrong credentials); the caller shows its own message.
        } else if (status === 401) {
          this.clearSession();
          this.clearApiKey();
          if (typeof window !== "undefined" && window.location.pathname !== "/login") {
            // Hard navigation, not router.push: this runs outside React (an
            // axios interceptor) and a full reload is wanted anyway, to drop
            // all React Query cache for the now-invalid session.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/login";
          }
        } else if (skipToast) {
          // Caller renders its own error state (e.g. a "not available yet" gap notice).
        } else if (status === 429) {
          toast.error("Rate limited", {
            description: "Too many requests. Please try again shortly.",
          });
        } else if (status !== undefined) {
          toast.error("Something went wrong", {
            description: message ?? `Request failed (${status})`,
          });
        } else {
          toast.error("Network error", {
            description: "Could not reach the API. Check your connection.",
          });
        }

        return Promise.reject(error);
      },
    );
  }

  setApiKey(key: string): void {
    this.apiKey = key;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, key);
    }
    this.notifyAuthListeners();
  }

  getApiKey(): string | null {
    if (!this.apiKey && typeof window !== "undefined") {
      this.apiKey = window.localStorage.getItem(API_KEY_STORAGE_KEY);
    }
    return this.apiKey;
  }

  clearApiKey(): void {
    this.apiKey = null;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
    this.notifyAuthListeners();
  }

  isAuthenticated(): boolean {
    return this.getSession() !== null || this.getApiKey() !== null;
  }

  /** True when a person is signed in (as opposed to the legacy tenant API key). */
  hasSession(): boolean {
    return this.getSession() !== null;
  }

  getSession(): string | null {
    if (!this.session && typeof window !== "undefined") {
      this.session = window.localStorage.getItem(SESSION_STORAGE_KEY);
    }
    return this.session;
  }

  getWorkspaceId(): string | null {
    if (!this.workspaceId && typeof window !== "undefined") {
      this.workspaceId = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    }
    return this.workspaceId;
  }

  setSession(token: string, workspaceId?: string): void {
    this.session = token;
    if (workspaceId) this.workspaceId = workspaceId;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_STORAGE_KEY, token);
      if (workspaceId) window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
    }
    this.notifyAuthListeners();
  }

  clearSession(): void {
    this.session = null;
    this.workspaceId = null;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
    this.notifyAuthListeners();
  }

  /** For useSyncExternalStore — notifies on setApiKey/clearApiKey. */
  subscribeAuth(listener: () => void): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  private notifyAuthListeners(): void {
    for (const listener of this.authListeners) listener();
  }

  // ---- Tenant API (/api/v1/*, `apikey` header) ---------------------------

  async sendMessage(data: SendMessageRequest): Promise<SendMessageResponse> {
    const response = await this.client.post<SendMessageResponse>("/api/v1/message/send", data);
    return response.data;
  }

  async getMessages(params?: MessageListParams): Promise<PaginatedResponse<Message>> {
    const response = await this.client.get<PaginatedResponse<Message>>("/api/v1/messages", {
      params,
    });
    return response.data;
  }

  async getMessage(id: string): Promise<Message> {
    const response = await this.client.get<ApiSuccess<Message>>(`/api/v1/messages/${id}`);
    return response.data.data;
  }

  async getDevices(): Promise<Device[]> {
    const response = await this.client.get<ApiSuccess<Device[]>>("/api/v1/devices");
    return response.data.data;
  }

  async getDevice(deviceKey: string): Promise<Device> {
    const response = await this.client.get<ApiSuccess<Device>>(`/api/v1/devices/${deviceKey}`);
    return response.data.data;
  }

  async getDeviceQR(deviceKey: string): Promise<QRCodeResponse> {
    const response = await this.client.get<QRCodeResponse>(`/api/v1/devices/${deviceKey}/qr`, {
      skipErrorToast: true,
    });
    return response.data;
  }

  async pauseDevice(deviceKey: string): Promise<Device> {
    const response = await this.client.post<ApiSuccess<Device>>(
      `/api/v1/devices/${deviceKey}/pause`,
    );
    return response.data.data;
  }

  async resumeDevice(deviceKey: string): Promise<Device> {
    const response = await this.client.post<ApiSuccess<Device>>(
      `/api/v1/devices/${deviceKey}/resume`,
    );
    return response.data.data;
  }

  /** Tenant self-service device creation (POST /api/v1/devices). Errors render inline in the form. */
  async createDevice(data: CreateDeviceRequest): Promise<Device> {
    const response = await this.client.post<ApiSuccess<Device>>("/api/v1/devices", data, {
      skipErrorToast: true,
    });
    return response.data.data;
  }

  // ---- Contacts ----------------------------------------------------------

  async getContacts(params?: ContactListParams): Promise<PaginatedResponse<ContactRecord>> {
    const response = await this.client.get<PaginatedResponse<ContactRecord>>("/api/v1/contacts", {
      params,
    });
    return response.data;
  }

  async createContact(data: CreateContactRequest): Promise<ContactRecord> {
    const response = await this.client.post<ApiSuccess<ContactRecord>>("/api/v1/contacts", data, {
      skipErrorToast: true,
    });
    return response.data.data;
  }

  async deleteContact(id: string): Promise<void> {
    await this.client.delete(`/api/v1/contacts/${id}`);
  }

  /** Server-side CSV parse/upsert; header needs phone_number|phone|number. */
  async importContacts(csv: string): Promise<{ imported: number }> {
    const response = await this.client.post<ApiSuccess<{ imported: number }>>(
      "/api/v1/contacts/import",
      { csv },
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  // ---- Auto-reply rules --------------------------------------------------

  async getAutoReplyRules(): Promise<AutoReplyRule[]> {
    const response = await this.client.get<ApiSuccess<AutoReplyRule[]>>("/api/v1/auto-reply-rules", {
      skipErrorToast: true,
    });
    return response.data.data;
  }

  async createAutoReplyRule(data: AutoReplyRuleInput): Promise<AutoReplyRule> {
    const response = await this.client.post<ApiSuccess<AutoReplyRule>>(
      "/api/v1/auto-reply-rules",
      data,
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  async updateAutoReplyRule(id: string, data: Partial<AutoReplyRuleInput>): Promise<AutoReplyRule> {
    const response = await this.client.patch<ApiSuccess<AutoReplyRule>>(
      `/api/v1/auto-reply-rules/${id}`,
      data,
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  async toggleAutoReplyRule(id: string): Promise<AutoReplyRule> {
    const response = await this.client.post<ApiSuccess<AutoReplyRule>>(
      `/api/v1/auto-reply-rules/${id}/toggle`,
      undefined,
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  async deleteAutoReplyRule(id: string): Promise<void> {
    await this.client.delete(`/api/v1/auto-reply-rules/${id}`, { skipErrorToast: true });
  }

  // ---- Analytics ---------------------------------------------------------

  async getAnalyticsOverview(): Promise<AnalyticsOverview> {
    const response = await this.client.get<ApiSuccess<AnalyticsOverview>>(
      "/api/v1/analytics/overview",
    );
    return response.data.data;
  }

  async getAnalyticsDaily(days = 14): Promise<AnalyticsDailyPoint[]> {
    const response = await this.client.get<ApiSuccess<AnalyticsDailyPoint[]>>(
      "/api/v1/analytics/daily",
      { params: { days } },
    );
    return response.data.data;
  }

  /** Permanent: removes the bot container, its session and the device row. */
  async deleteDevice(deviceKey: string): Promise<void> {
    await this.client.delete(`/api/v1/devices/${deviceKey}`, { skipErrorToast: true });
  }

  async getMyTenant() {
    const response = await this.client.get<ApiSuccess<Tenant>>("/api/v1/tenant", {
      skipErrorToast: true,
    });
    return response.data.data;
  }

  /** Not implemented by api-gateway yet — see dashboard/README.md "Known gaps". */
  async regenerateApiKey() {
    const response = await this.client.post<ApiSuccess<{ api_key: string }>>(
      "/api/v1/tenant/api-key/regenerate",
      undefined,
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  async getDeviceHealth(deviceKey: string): Promise<DeviceHealthData> {
    const response = await this.client.get<ApiSuccess<DeviceHealthData>>(
      `/api/v1/devices/${deviceKey}/health`,
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  async updateWebhookUrl(webhookUrl: string) {
    const response = await this.client.patch<ApiSuccess<Tenant>>(
      "/api/v1/tenant",
      { webhook_url: webhookUrl },
      { skipErrorToast: true },
    );
    return response.data.data;
  }

  // ---- Accounts (/auth/*) -------------------------------------------------

  async login(email: string, password: string): Promise<AuthResult> {
    const response = await this.client.post<ApiSuccess<AuthResult>>(
      "/auth/login", { email, password }, { skipErrorToast: true, skipAuthRedirect: true },
    );
    return response.data.data;
  }

  async signup(data: { email: string; password: string; name: string; workspace_name?: string; accept_terms: true }): Promise<AuthResult> {
    const response = await this.client.post<ApiSuccess<AuthResult>>(
      "/auth/signup", data, { skipErrorToast: true, skipAuthRedirect: true },
    );
    return response.data.data;
  }

  async logoutRemote(): Promise<void> {
    if (!this.getSession()) return;
    await this.client.post("/auth/logout", undefined, { skipErrorToast: true, skipAuthRedirect: true }).catch(() => undefined);
  }

  async getMe(): Promise<Me> {
    const response = await this.client.get<ApiSuccess<Me>>("/auth/me", { skipErrorToast: true });
    return response.data.data;
  }

  async previewInvitation(token: string): Promise<InvitationPreview> {
    const response = await this.client.get<ApiSuccess<InvitationPreview>>(
      `/auth/invitations/${token}`, { skipErrorToast: true, skipAuthRedirect: true },
    );
    return response.data.data;
  }

  async acceptInvitation(token: string, body?: { name: string; password: string; accept_terms: true }): Promise<{
    joined: { id: string; name: string; role: Role }; session?: AuthResult;
  }> {
    const response = await this.client.post<ApiSuccess<{ joined: { id: string; name: string; role: Role }; session?: AuthResult }>>(
      `/auth/invitations/${token}/accept`, body ?? {}, { skipErrorToast: true, skipAuthRedirect: true },
    );
    return response.data.data;
  }

  // ---- API keys, team, audit ----------------------------------------------

  async getApiKeys(): Promise<{ keys: ApiKeyRecord[]; scopes: string[] }> {
    const response = await this.client.get<{ data: ApiKeyRecord[]; available_scopes: string[] }>("/api/v1/keys", { skipErrorToast: true });
    return { keys: response.data.data, scopes: response.data.available_scopes };
  }

  async createApiKey(data: { name: string; scopes: string[]; expires_in_days?: number }): Promise<CreatedApiKey> {
    const response = await this.client.post<ApiSuccess<CreatedApiKey>>("/api/v1/keys", data, { skipErrorToast: true });
    return response.data.data;
  }

  async rotateApiKey(id: string, overlapHours = 24): Promise<CreatedApiKey> {
    const response = await this.client.post<ApiSuccess<CreatedApiKey>>(
      `/api/v1/keys/${id}/rotate`, { overlap_hours: overlapHours }, { skipErrorToast: true },
    );
    return response.data.data;
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.client.delete(`/api/v1/keys/${id}`, { skipErrorToast: true });
  }

  async getTeam(): Promise<{ members: TeamMember[]; invitations: PendingInvitation[] }> {
    const response = await this.client.get<ApiSuccess<{ members: TeamMember[]; invitations: PendingInvitation[] }>>(
      "/api/v1/team", { skipErrorToast: true },
    );
    return response.data.data;
  }

  async inviteMember(email: string, role: Role): Promise<CreatedInvitation> {
    const response = await this.client.post<ApiSuccess<CreatedInvitation>>(
      "/api/v1/team/invitations", { email, role }, { skipErrorToast: true },
    );
    return response.data.data;
  }

  async revokeInvitation(id: string): Promise<void> {
    await this.client.delete(`/api/v1/team/invitations/${id}`, { skipErrorToast: true });
  }

  async changeMemberRole(userId: string, role: Role): Promise<void> {
    await this.client.patch(`/api/v1/team/members/${userId}`, { role }, { skipErrorToast: true });
  }

  async removeMember(userId: string): Promise<void> {
    await this.client.delete(`/api/v1/team/members/${userId}`, { skipErrorToast: true });
  }

  async getAudit(limit = 50, before?: string): Promise<AuditEntry[]> {
    const response = await this.client.get<ApiSuccess<AuditEntry[]>>(
      "/api/v1/audit", { params: { limit, before }, skipErrorToast: true },
    );
    return response.data.data;
  }

  // ---- Status and device profile --------------------------------

  async postStatus(deviceKey: string, body: StatusPost): Promise<{ command_id: string; status: string; run_at: string }> {
    return (await this.client.post<ApiSuccess<{ command_id: string; status: string; run_at: string }>>(`/api/v1/devices/${deviceKey}/status`, body, { skipErrorToast: true })).data.data;
  }
  async getStatusPosts(deviceKey: string): Promise<DeviceCommand[]> {
    return (await this.client.get<ApiSuccess<DeviceCommand[]>>(`/api/v1/devices/${deviceKey}/status`, { skipErrorToast: true })).data.data;
  }
  async getStatusViewers(deviceKey: string, id: string): Promise<StatusViewers> {
    return (await this.client.get<ApiSuccess<StatusViewers>>(`/api/v1/devices/${deviceKey}/commands/${id}/viewers`, { skipErrorToast: true })).data.data;
  }
  async cancelCommand(deviceKey: string, id: string): Promise<void> {
    await this.client.post(`/api/v1/devices/${deviceKey}/commands/${id}/cancel`, {}, { skipErrorToast: true });
  }
  // Profile calls wait for the device to answer, so allow a generous timeout.
  async getProfile(deviceKey: string): Promise<DeviceProfile> {
    return (await this.client.get<ApiSuccess<DeviceProfile>>(`/api/v1/devices/${deviceKey}/profile`, { skipErrorToast: true, timeout: 30_000 })).data.data;
  }
  async updateProfile(deviceKey: string, body: ProfileUpdate): Promise<DeviceProfile> {
    return (await this.client.patch<ApiSuccess<DeviceProfile>>(`/api/v1/devices/${deviceKey}/profile`, body, { skipErrorToast: true, timeout: 45_000 })).data.data;
  }
  async setProfilePicture(deviceKey: string, imageBase64: string): Promise<DeviceProfile> {
    return (await this.client.post<ApiSuccess<DeviceProfile>>(`/api/v1/devices/${deviceKey}/profile/picture`, { image_base64: imageBase64 }, { skipErrorToast: true, timeout: 60_000 })).data.data;
  }
  async removeProfilePicture(deviceKey: string): Promise<DeviceProfile> {
    return (await this.client.delete<ApiSuccess<DeviceProfile>>(`/api/v1/devices/${deviceKey}/profile/picture`, { skipErrorToast: true, timeout: 45_000 })).data.data;
  }

  // ---- Webhook -------------------------------------------------------------

  async getWebhook(): Promise<WebhookSettings> {
    return (await this.client.get<ApiSuccess<WebhookSettings>>("/api/v1/tenant/webhook", { skipErrorToast: true })).data.data;
  }
  async rotateWebhookSecret(): Promise<string> {
    return (await this.client.post<ApiSuccess<{ secret: string }>>("/api/v1/tenant/webhook/secret", {}, { skipErrorToast: true })).data.data.secret;
  }
  async testWebhook(): Promise<WebhookTestResult> {
    return (await this.client.post<ApiSuccess<WebhookTestResult>>("/api/v1/tenant/webhook/test", {}, { skipErrorToast: true })).data.data;
  }
  async getWebhookLogs(): Promise<WebhookLog[]> {
    return (await this.client.get<ApiSuccess<WebhookLog[]>>("/api/v1/tenant/webhook/logs", { skipErrorToast: true })).data.data;
  }

  // ---- Plans and billing ---------------------------------------------------

  async getPublicInfo(): Promise<{ support_contact: string | null }> {
    const response = await this.client.get<ApiSuccess<{ support_contact: string | null }>>("/public/info", { skipErrorToast: true });
    return response.data.data;
  }

  async getPublicPlans(): Promise<PublicPlan[]> {
    const response = await this.client.get<ApiSuccess<PublicPlan[]>>("/public/plans", { skipErrorToast: true });
    return response.data.data;
  }

  async getBilling(): Promise<BillingState> {
    const response = await this.client.get<ApiSuccess<BillingState>>("/api/v1/billing", { skipErrorToast: true });
    return response.data.data;
  }

  async createOrder(plan: string, cycle: BillingCycle): Promise<{ invoice: Invoice; payment: BillingState["payment"] }> {
    const response = await this.client.post<{ data: Invoice; payment: BillingState["payment"] }>(
      "/api/v1/billing/orders", { plan, cycle }, { skipErrorToast: true },
    );
    return { invoice: response.data.data, payment: response.data.payment };
  }

  async requestStudentVerification(note: string): Promise<void> {
    await this.client.post("/api/v1/billing/student-request", { note }, { skipErrorToast: true });
  }

  // ---- Sending behaviour --------------------------------------------------

  async getPresets(): Promise<Preset[]> {
    const response = await this.client.get<ApiSuccess<Preset[]>>("/api/v1/presets", { skipErrorToast: true });
    return response.data.data;
  }

  async applyPreset(deviceKey: string, preset: PresetId): Promise<Persona> {
    const response = await this.client.post<ApiSuccess<Persona>>(
      `/api/v1/devices/${deviceKey}/preset`, { preset }, { skipErrorToast: true },
    );
    return response.data.data;
  }

  async updatePersona(deviceKey: string, patch: Partial<Record<string, number | boolean>>): Promise<void> {
    await this.client.patch(`/api/v1/devices/${deviceKey}/persona`, patch, { skipErrorToast: true });
  }

  async getDeviceActivity(deviceKey: string, days = 14): Promise<DeviceActivity> {
    const response = await this.client.get<ApiSuccess<DeviceActivity>>(
      `/api/v1/devices/${deviceKey}/activity`, { params: { days }, skipErrorToast: true },
    );
    return response.data.data;
  }

  async getDeviceEvents(deviceKey: string, limit = 20): Promise<DeviceEvent[]> {
    const response = await this.client.get<ApiSuccess<DeviceEvent[]>>(
      `/api/v1/devices/${deviceKey}/events`, { params: { limit }, skipErrorToast: true },
    );
    return response.data.data;
  }
}

export const api = new ApiClient();
