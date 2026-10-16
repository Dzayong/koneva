"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthShell, TermsLabel } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";

export default function SignupPage() {
  const { loginWithSession } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [phone, setPhone] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<'email' | 'whatsapp'>('email');
  const [terms, setTerms] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<'email' | 'whatsapp'>('email');
  const [code, setCode] = useState("");
  const [resendWait, setResendWait] = useState(0);
  const [error, setError] = useState<{ message: string; taken?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordOk = password.length >= 10;

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = setTimeout(() => setResendWait((wait) => wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendWait]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terms) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.signup({
        name: name.trim(), email: email.trim(), password,
        ...(workspace.trim() ? { workspace_name: workspace.trim() } : {}),
        verification_method: verificationMethod,
        ...(verificationMethod === 'whatsapp' ? { phone_number: phone.trim() } : {}),
        accept_terms: true,
      });
      setPendingEmail(result.email);
      setPendingMethod(result.verification_method);
      setCode("");
      setResendWait(result.resend_after);
      setPassword("");
      setError(null);
    } catch (err) {
      const failure = apiFailure(err);
      setError(
        failure.code === "EMAIL_TAKEN" ? { message: "Email ini sudah terdaftar.", taken: true }
        : failure.status === 429 ? { message: "Terlalu banyak percobaan. Coba lagi nanti." }
        : failure.code === "SIGNUP_DISABLED" ? { message: "Pendaftaran sedang ditutup." }
        : { message: failure.message },
      );
    } finally { setBusy(false); }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEmail) return;
    setError(null); setBusy(true);
    try {
      loginWithSession(await api.confirmSignupEmailVerification(pendingEmail, code, pendingMethod), "/dashboard?welcome=1");
    } catch (err) {
      const failure = apiFailure(err);
      setError({ message: failure.code === "OTP_INVALID" ? "Kode salah, kedaluwarsa, atau sudah dipakai. Minta kode baru." : failure.message });
    } finally { setBusy(false); }
  };

  const resend = async () => {
    if (!pendingEmail) return;
    setError(null); setBusy(true);
    try {
      const result = await api.requestSignupEmailVerification(pendingEmail, pendingMethod);
      setResendWait(result.resend_after);
    } catch (err) {
      const failure = apiFailure(err);
      setError({ message: failure.code === "OTP_COOLDOWN" ? "Tunggu sebentar sebelum meminta kode lagi." : failure.message });
    } finally { setBusy(false); }
  };

  return (
    <AuthShell background="signup">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{pendingEmail ? `Verifikasi ${pendingMethod === 'whatsapp' ? 'WhatsApp' : 'email'}` : "Buat akun"}</CardTitle>
          <CardDescription>{pendingEmail
            ? pendingMethod === 'whatsapp'
              ? `Masukkan kode 6 digit yang dikirim ke nomor WhatsApp Anda. Akun dan workspace aktif setelah nomor terverifikasi; email tetap belum terverifikasi sampai Anda mengonfirmasinya nanti.`
              : `Masukkan kode 6 digit yang kami kirim ke ${pendingEmail}. Akun dan workspace baru aktif setelah email terverifikasi.`
            : "Pilih email atau WhatsApp untuk menerima kode verifikasi."}</CardDescription>
        </CardHeader>
        {pendingEmail ? <form onSubmit={confirm}>
          <CardContent className="space-y-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="signup-verify-code">Kode verifikasi {pendingMethod === 'whatsapp' ? 'WhatsApp' : 'email'}</Label>
              <Input id="signup-verify-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memverifikasi…</> : "Verifikasi dan aktifkan akun"}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={resend} disabled={busy || resendWait > 0}>
              {resendWait > 0 ? `Kirim ulang kode (${resendWait} dtk)` : "Kirim ulang kode"}
            </Button>
            <button type="button" className="text-sm underline" onClick={() => { setPendingEmail(null); setCode(""); setError(null); }}>
              Kembali ke formulir pendaftaran
            </button>
          </CardFooter>
        </form> : <form onSubmit={submit}>
          <CardContent className="space-y-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nama</Label>
              <Input id="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Kata sandi</Label>
              <PasswordInput id="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-hint" />
              <p id="password-hint" className={`text-xs ${password && !passwordOk ? "text-destructive" : "text-muted-foreground"}`}>
                Minimal 10 karakter{password ? ` (${password.length})` : ""}.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace">Nama workspace <span className="font-normal text-muted-foreground">(opsional)</span></Label>
              <Input id="workspace" maxLength={80} placeholder="mis. Toko Sinar" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Kirim kode verifikasi melalui</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                <input type="radio" name="verification_method" value="email" checked={verificationMethod === 'email'} onChange={() => setVerificationMethod('email')} className="mt-0.5" />
                <span><span className="block font-medium">Email</span><span className="text-muted-foreground">Email harus bisa menerima kode verifikasi.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                <input type="radio" name="verification_method" value="whatsapp" checked={verificationMethod === 'whatsapp'} onChange={() => setVerificationMethod('whatsapp')} className="mt-0.5" />
                <span><span className="block font-medium">WhatsApp</span><span className="text-muted-foreground">Memverifikasi nomor; email tetap belum terverifikasi dan tetap diperlukan untuk pemulihan sandi.</span></span>
              </label>
            </fieldset>
            {verificationMethod === 'whatsapp' && <div className="space-y-2">
              <Label htmlFor="signup-phone">Nomor WhatsApp</Label>
              <Input id="signup-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="08xxxxxxxxxx atau +628xxxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <p className="text-xs text-muted-foreground">Kode akan dikirim dari nomor pengirim verifikasi KONEVA yang terhubung.</p>
            </div>}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-snug">
              <input id="terms" type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
              <span><TermsLabel /></span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error.message}{" "}
                {error.taken && <Link href="/login" className="font-medium underline underline-offset-4">Masuk saja</Link>}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy || !terms || !passwordOk || !name.trim() || !email || (verificationMethod === 'whatsapp' && phone.trim().length < 8)}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Membuat akun…</> : "Buat akun"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Sudah punya akun?{" "}
              <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Masuk</Link>
            </p>
          </CardFooter>
        </form>}
      </Card>
    </AuthShell>
  );
}
