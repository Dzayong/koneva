import axios, { type AxiosInstance, type AxiosError } from "axios";
import { toast } from "sonner";
import { API_BASE_URL, API_KEY_STORAGE_KEY } from "./constants";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Suppress the global error toast — caller renders its own error state instead. */
    skipErrorToast?: boolean;
  }
}
import type {
  ApiErrorBody,
  ApiSuccess,
  CreateDeviceRequest,
  Device,
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
  private authListeners = new Set<() => void>();

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: { "Content-Type": "application/json" },
    });

    this.client.interceptors.request.use((config) => {
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

        if (status === 401) {
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
    return this.getApiKey() !== null;
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
    const response = await this.client.get<QRCodeResponse>(`/api/v1/devices/${deviceKey}/qr`);
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

  /**
   * Not implemented by api-gateway yet (only /admin/device/create exists,
   * which requires the operator's admin key, not a tenant's). Wired against
   * the endpoint api-gateway should expose for tenant self-service. See
   * dashboard/README.md "Known gaps".
   */
  async createDevice(data: CreateDeviceRequest): Promise<Device> {
    const response = await this.client.post<ApiSuccess<Device>>("/api/v1/devices", data, {
      skipErrorToast: true,
    });
    return response.data.data;
  }

  /** Not implemented by api-gateway yet — see dashboard/README.md "Known gaps". */
  async deleteDevice(deviceKey: string): Promise<void> {
    await this.client.delete(`/api/v1/devices/${deviceKey}`, { skipErrorToast: true });
  }

  /** Not implemented by api-gateway yet — see dashboard/README.md "Known gaps". */
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

  /** Not implemented by api-gateway yet — see dashboard/README.md "Known gaps". */
  async updateWebhookUrl(webhookUrl: string) {
    const response = await this.client.patch<ApiSuccess<Tenant>>(
      "/api/v1/tenant",
      { webhook_url: webhookUrl },
      { skipErrorToast: true },
    );
    return response.data.data;
  }
}

export const api = new ApiClient();
