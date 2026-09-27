export type OperatorErrorKind =
  | "network"          // no answer: the outcome of a mutation is UNKNOWN
  | "timeout"          // our own deadline passed: NOT proof that nothing happened
  | "untrusted"        // an answer we cannot trust (proxy page, wrong shape) to a mutation: outcome UNKNOWN
  | "unavailable"      // the operator API does not exist on this server (reads and sign-in only)
  | "unauthenticated" | "session_expired" | "reauth_required" | "invalid_credentials"
  | "forbidden" | "csrf" | "origin"
  | "not_found" | "conflict" | "validation" | "rate_limited" | "server";

export class OperatorApiError extends Error {
  constructor(
    readonly kind: OperatorErrorKind,
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "OperatorApiError";
  }

  /** True when the request may or may not have taken effect on the server (no definite answer). */
  get outcomeUnknown(): boolean {
    // AUDIT_FAILED is definite ONLY when the server says it rolled back before COMMIT (details.rolled_back === true).
    if (this.code === "AUDIT_FAILED") return this.details["rolled_back"] !== true;
    if (this.code === "OUTCOME_UNKNOWN") return true;
    // REAUTH_REQUIRED is refused before any effect, so it is definite (kind reauth_required, status 401).
    return this.kind === "network" || this.kind === "timeout" || this.kind === "untrusted" || (this.kind === "server" && this.status >= 500);
  }

  /** The session is gone; the panel must send the operator back to sign-in. */
  get sessionLost(): boolean {
    return this.kind === "unauthenticated" || this.kind === "session_expired";
  }
}

export function kindFor(status: number, code: string): OperatorErrorKind {
  if (status === 401) {
    if (code === "SESSION_EXPIRED") return "session_expired";
    if (code === "REAUTH_REQUIRED") return "reauth_required";
    if (code === "INVALID_CREDENTIALS") return "invalid_credentials";
    return "unauthenticated";
  }
  if (status === 403) return code === "CSRF_INVALID" ? "csrf" : code === "ORIGIN_NOT_ALLOWED" ? "origin" : "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status === 429) return "rate_limited";
  return "server";
}

const TEXT: Record<string, string> = {
  INVALID_CREDENTIALS: "Email atau kata sandi salah.",
  SESSION_EXPIRED: "Sesi Anda berakhir. Silakan masuk lagi.",
  UNAUTHENTICATED: "Anda belum masuk.",
  REAUTH_REQUIRED: "Untuk aksi ini Anda perlu masuk ulang.",
  NOT_OPERATOR: "Akun ini bukan operator platform.",
  FORBIDDEN: "Peran Anda tidak boleh melakukan ini.",
  CSRF_INVALID: "Permintaan ditolak karena token keamanan tidak valid. Muat ulang halaman lalu coba lagi.",
  ORIGIN_NOT_ALLOWED: "Permintaan ditolak karena berasal dari alamat yang tidak diizinkan.",
  RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar.",
  INVOICE_NOT_FOUND: "Invoice tidak ditemukan.",
  INVOICE_NOT_PAYABLE: "Invoice ini sudah diproses.",
  INVOICE_CHANGED: "Data invoice berubah sejak Anda membukanya.",
  STUDENT_NOT_VERIFIED: "Paket Pelajar butuh persetujuan status pelajar lebih dulu.",
  DUPLICATE_REFERENCE: "Referensi pembayaran ini sudah dipakai pada invoice lain.",
  IDEMPOTENCY_KEY_REUSED: "Kunci permintaan sudah dipakai untuk isi yang berbeda.",
  REQUEST_IN_PROGRESS: "Permintaan yang sama sedang diproses. Tunggu sebentar lalu periksa status.",
  REQUEST_NOT_PENDING: "Pengajuan ini sudah diputuskan.",
  REQUEST_CHANGED: "Pengajuan berubah sejak Anda membukanya.",
  REQUEST_SUPERSEDED: "Pengajuan ini sudah digantikan pengajuan yang lebih baru.",
  REASON_REQUIRED: "Alasan wajib diisi untuk menolak.",
  AUDIT_FAILED: "Perubahan dibatalkan karena pencatatan audit gagal. Tidak ada yang berubah.",
  OUTCOME_UNKNOWN: "Hasil belum pasti. Periksa status atau ulangi dengan kunci yang sama.",
  MFA_INVALID: "Kode verifikasi salah atau sudah dipakai.",
  MFA_CHALLENGE_INVALID: "Verifikasi berakhir. Silakan masuk lagi.",
  ENROLLMENT_CODE_INVALID: "Kode pendaftaran salah atau kedaluwarsa.",
  VALIDATION_ERROR: "Isian tidak valid.",
};

export function operatorErrorText(error: unknown): string {
  if (!(error instanceof OperatorApiError)) return "Terjadi kesalahan. Coba lagi.";
  if (error.kind === "network") return "Tidak bisa menghubungi server. Periksa koneksi Anda.";
  if (error.kind === "timeout") return "Server terlalu lama menjawab.";
  if (error.kind === "untrusted") return "Jawaban server tidak dapat dipercaya.";
  if (error.kind === "unavailable") return "Layanan operator belum tersedia di server ini.";
  return TEXT[error.code] ?? (error.kind === "server" ? "Server bermasalah. Coba lagi nanti." : error.message || "Terjadi kesalahan.");
}
