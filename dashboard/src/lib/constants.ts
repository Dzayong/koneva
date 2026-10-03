export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const SESSION_STORAGE_KEY = "wa_gateway_session";
export const WORKSPACE_STORAGE_KEY = "wa_gateway_workspace";

export const QUERY_STALE_TIME_MS = 30_000;
export const DEVICES_REFETCH_INTERVAL_MS = 30_000;
export const DEVICE_REFETCH_INTERVAL_MS = 15_000;
export const MESSAGES_REFETCH_INTERVAL_MS = 30_000;
export const QR_REFETCH_INTERVAL_MS = 5_000;
