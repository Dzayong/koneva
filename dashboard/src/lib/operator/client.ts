import { kindFor, OperatorApiError } from "./errors";

/**
 * Same-origin client for the operator API (/api/operator/* -> backend /operator/*).
 * Deliberately separate from lib/api.ts (the tenant client): it never reads or writes localStorage, never touches
 * tenant sessions or API keys, and a 401 here never clears anything outside the operator scope.
 * The session is an HttpOnly cookie the browser sends by itself; only the CSRF token lives here, in memory.
 */
const BASE = "/api/operator";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /**
   * True for requests that change business state (default: whenever an idempotency key is sent). For those, anything
   * other than a clean enveloped answer is an UNKNOWN outcome, never "it failed".
   */
  effectful?: boolean;
  timeoutMs?: number;
}

export const READ_TIMEOUT_MS = 15_000;
export const WRITE_TIMEOUT_MS = 30_000;

export interface Envelope<T> { data: T; pagination?: unknown }

type SessionLostListener = (reason: "expired" | "unauthenticated") => void;

class OperatorClient {
  private csrf: string | null = null;
  private listeners = new Set<SessionLostListener>();

  setCsrf(token: string | null): void { this.csrf = token; }
  hasCsrf(): boolean { return this.csrf !== null; }
  onSessionLost(listener: SessionLostListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notifyLost(reason: "expired" | "unauthenticated"): void {
    this.csrf = null;
    this.listeners.forEach((l) => l(reason));
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<Envelope<T> | undefined> {
    const method = options.method ?? "GET";
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;

    const headers: Record<string, string> = { Accept: "application/json", "X-Requested-With": "koneva-operator" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (UNSAFE.has(method) && this.csrf) headers["X-CSRF-Token"] = this.csrf;
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const effectful = options.effectful ?? options.idempotencyKey !== undefined;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? (method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS));
    options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const failed = (error: unknown): never => {
      // Our deadline is not evidence that nothing happened; a caller-initiated abort (query cancelled) is passed through.
      if (timedOut) throw new OperatorApiError("timeout", 0, "TIMEOUT", "No answer within the deadline");
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new OperatorApiError("network", 0, "NETWORK", "No response from the server");
    };

    try {
      let response: Response;
      try {
        // redirect "error": a redirect (e.g. a proxy sending us to a login page) is not the operator API answering.
        response = await fetch(url, {
          method, headers, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch (error) { return failed(error); }

      // 204 (logout): no body and no envelope to parse.
      if (response.status === 204) return undefined;

      let json: unknown;
      try { json = await response.json(); } catch (error) { if (timedOut) return failed(error); json = undefined; }
      const body = json && typeof json === "object" ? (json as Record<string, unknown>) : undefined;

      if (!response.ok) {
        const err = body && typeof body["error"] === "object" && body["error"] ? (body["error"] as Record<string, unknown>) : undefined;
        if (!err) {
          // Not our envelope: a proxy/HTML error page, or the endpoint simply does not exist on this server.
          if (effectful) throw new OperatorApiError("untrusted", response.status, "UNTRUSTED_RESPONSE", `HTTP ${response.status}`);
          const unavailable = response.status === 404 || response.status >= 502;
          throw new OperatorApiError(unavailable ? "unavailable" : "server", response.status, unavailable ? "UNAVAILABLE" : "SERVER_ERROR", `HTTP ${response.status}`);
        }
        const code = typeof err["code"] === "string" ? err["code"] : "ERROR";
        const retry = Number(response.headers.get("Retry-After"));
        const apiError = new OperatorApiError(
          kindFor(response.status, code), response.status, code, typeof err["message"] === "string" ? err["message"] : `HTTP ${response.status}`,
          err["details"] && typeof err["details"] === "object" ? (err["details"] as Record<string, unknown>) : {},
          Number.isFinite(retry) && retry > 0 ? retry : null,
        );
        if (apiError.kind === "session_expired") this.notifyLost("expired");
        else if (apiError.kind === "unauthenticated") this.notifyLost("unauthenticated");
        throw apiError;
      }

      if (!body || body["success"] !== true) {
        // A 2xx we cannot read: for a mutation the effect may well have happened.
        throw new OperatorApiError(effectful ? "untrusted" : "server", response.status, effectful ? "UNTRUSTED_RESPONSE" : "BAD_RESPONSE", "Unexpected response shape");
      }
      return { data: body["data"] as T, pagination: body["pagination"] };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const operatorClient = new OperatorClient();
