import { isAxiosError } from "axios";

export interface ApiFailure {
  status?: number;
  code?: string;
  message: string;
}

/** Reads the API's `{ error: { code, message } }` shape; falls back to a generic message. */
export function apiFailure(error: unknown, fallback = "Terjadi kesalahan. Coba lagi."): ApiFailure {
  if (isAxiosError(error)) {
    const body = error.response?.data as { error?: { code?: string; message?: string } } | undefined;
    return {
      status: error.response?.status,
      code: body?.error?.code,
      message: body?.error?.message ?? (error.response ? fallback : "Tidak bisa menghubungi server. Periksa koneksi Anda."),
    };
  }
  return { message: fallback };
}
