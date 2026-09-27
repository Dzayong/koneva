"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOperatorAuthFlow } from "@/hooks/use-operator-auth-flow";
import { copyText } from "@/lib/clipboard";
import { OperatorApiError, operatorErrorText } from "@/lib/operator/errors";

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const wait = error instanceof OperatorApiError && error.kind === "rate_limited" && error.retryAfterSeconds ? ` Coba lagi dalam ${error.retryAfterSeconds} detik.` : "";
  return <p role="alert" className="text-sm text-destructive">{operatorErrorText(error)}{wait}</p>;
}

function Submit({ pending, disabled, children }: { pending: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <Button type="submit" className="w-full" disabled={pending || disabled}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{children}</Button>;
}

/**
 * The whole operator sign-in: password, then a one-time code (or a recovery code), or first-time enrollment. A session
 * exists only after the last step, and the challenge id is kept in memory only.
 */
export function AuthFlowPanel({ fixedEmail, onSignedIn }: { fixedEmail?: string; onSignedIn: () => void }) {
  const flow = useOperatorAuthFlow(onSignedIn);
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [saved, setSaved] = useState(false);
  const { step, pending, error } = flow;

  if (step.kind === "credentials") {
    return (
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void flow.submitPassword(email.trim(), password).then(() => setPassword("")); }}>
        <div className="space-y-2">
          <Label htmlFor="op-email">Email</Label>
          <Input id="op-email" type="email" autoComplete="username" required value={email} readOnly={Boolean(fixedEmail)} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2"><Label htmlFor="op-password">Kata sandi</Label><Input id="op-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <ErrorLine error={error} />
        <Submit pending={pending} disabled={!email.trim() || !password}>Lanjut</Submit>
      </form>
    );
  }

  if (step.kind === "mfa") {
    const challengeId = step.challengeId;
    return (
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void flow.submitMfa(challengeId, recovery ? { recoveryCode: code.trim() } : { code: code.trim() }); }}>
        <p className="text-sm text-muted-foreground">{recovery ? "Masukkan salah satu kode pemulihan. Setiap kode hanya bisa dipakai sekali." : "Buka aplikasi autentikator Anda dan masukkan kode 6 digit."}</p>
        <div className="space-y-2">
          <Label htmlFor="op-code">{recovery ? "Kode pemulihan" : "Kode verifikasi"}</Label>
          <Input id="op-code" autoFocus inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={recovery ? 32 : 6} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" />
        </div>
        <ErrorLine error={error} />
        <Submit pending={pending} disabled={recovery ? code.trim().length < 8 : !/^\d{6}$/.test(code.trim())}>Verifikasi</Submit>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-primary underline underline-offset-2" onClick={() => { setRecovery((r) => !r); setCode(""); }}>{recovery ? "Pakai kode autentikator" : "Pakai kode pemulihan"}</button>
          <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={flow.restart}>Mulai lagi</button>
        </div>
      </form>
    );
  }

  if (step.kind === "enroll_code") {
    const challengeId = step.challengeId;
    return (
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void flow.submitEnrollmentCode(challengeId, code.trim()).then(() => setCode("")); }}>
        <p className="text-sm text-muted-foreground">Akun ini belum memakai verifikasi dua langkah. Masukkan kode pendaftaran sekali pakai yang Anda terima dari administrator.</p>
        <div className="space-y-2"><Label htmlFor="op-enroll">Kode pendaftaran</Label><Input id="op-enroll" autoFocus autoComplete="off" maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" /></div>
        <ErrorLine error={error} />
        <Submit pending={pending} disabled={code.trim().length < 8}>Lanjut</Submit>
        <button type="button" className="text-sm text-muted-foreground underline underline-offset-2" onClick={flow.restart}>Mulai lagi</button>
      </form>
    );
  }

  if (step.kind === "enroll_scan") {
    const { challengeId, secret, uri } = step;
    return (
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void flow.confirmEnrollment(challengeId, code.trim()); }}>
        <p className="text-sm text-muted-foreground">Pindai kode QR dengan aplikasi autentikator (misalnya Google Authenticator atau Aegis), lalu masukkan kode 6 digit yang muncul.</p>
        <div className="flex justify-center rounded-lg border bg-white p-3"><QRCodeSVG value={uri} size={168} aria-label="Kode QR autentikator" /></div>
        <div>
          <p className="text-xs text-muted-foreground">Tidak bisa memindai? Ketik kunci ini secara manual:</p>
          <code className="mt-1 block rounded bg-muted px-2 py-1.5 font-mono text-xs break-all select-all">{secret}</code>
        </div>
        <div className="space-y-2"><Label htmlFor="op-code">Kode verifikasi</Label><Input id="op-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" /></div>
        <ErrorLine error={error} />
        <Submit pending={pending} disabled={!/^\d{6}$/.test(code.trim())}>Aktifkan dan masuk</Submit>
      </form>
    );
  }

  if (step.kind === "recovery") {
    const text = step.codes.join("\n");
    return (
      <div className="space-y-4">
        <p className="text-sm">Verifikasi dua langkah aktif. Simpan <strong>kode pemulihan</strong> ini di tempat aman. Kode ini <strong>hanya ditampilkan sekali</strong> dan dipakai bila autentikator Anda hilang.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-3 font-mono text-sm" aria-label="Kode pemulihan">{step.codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <Button type="button" variant="outline" size="sm" onClick={async () => { const ok = await copyText(text); if (ok) toast.success("Kode tersalin"); else toast.error("Tidak bisa menyalin otomatis"); }}><Copy className="mr-1.5 h-4 w-4" />Salin semua</Button>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />Saya sudah menyimpan kode pemulihan ini.</label>
        <Button className="w-full" disabled={!saved} onClick={flow.acknowledgeRecovery}>Lanjut ke panel</Button>
      </div>
    );
  }

  return <p role="status" className="text-sm text-muted-foreground">Berhasil masuk…</p>;
}
