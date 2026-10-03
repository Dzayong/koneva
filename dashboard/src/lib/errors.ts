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

/**
 * The two synchronous consent-guard rejections from POST /message/send, /broadcast, and /messages/:id/retry
 * (src/api-gateway/services/recipient-consent.service.ts). This only explains the existing server rule in
 * plain language with a next step; it never changes or bypasses consent enforcement.
 */
export interface SendRejectionGuidance { title: string; description: string }
const SEND_REJECTION_GUIDANCE: Record<string, SendRejectionGuidance> = {
  RECIPIENT_CONSENT_REQUIRED: {
    title: "Penerima belum pernah memberi izin",
    description: 'Minta penerima mengirim "MULAI" atau "START" dari WhatsApp-nya ke nomor bisnis ini, atau catat izinnya secara manual di halaman Kontak dengan sumber bukti yang sah (misalnya formulir pendaftaran) sebelum mengirim.',
  },
  RECIPIENT_OPTED_OUT: {
    title: "Penerima sudah meminta berhenti",
    description: "Penerima pernah mengirim kata kunci berhenti dalam 365 hari terakhir. Jangan kirim promosi ke nomor ini lagi; pesan yang benar-benar diperlukan untuk layanan (OTP, konfirmasi pembayaran) tetap bisa dikirim dengan prioritas urgent.",
  },
};

export function sendRejectionGuidance(code: string | undefined): SendRejectionGuidance | null {
  return code ? SEND_REJECTION_GUIDANCE[code] ?? null : null;
}
