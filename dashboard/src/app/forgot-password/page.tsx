"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requested, setRequested] = useState(false);
  const [complete, setComplete] = useState(false);
  const [resendWait, setResendWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = window.setTimeout(() => setResendWait((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendWait]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.requestPasswordReset(email.trim());
      setEmail(email.trim());
      setRequested(true);
      setResendWait(result.resend_after);
    } catch (cause) {
      const failure = apiFailure(cause);
      setError(failure.status === 429 ? "Tunggu sebentar sebelum meminta kode lagi." : failure.message);
    } finally { setBusy(false); }
  };

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    await sendCode();
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Konfirmasi kata sandi belum sama.");
      return;
    }
    setBusy(true);
    try {
      await api.confirmPasswordReset(email, code, password);
      setComplete(true);
    } catch (cause) {
      const failure = apiFailure(cause);
      setError(failure.code === "OTP_INVALID" ? "Kode salah, kedaluwarsa, atau sudah dipakai. Minta kode baru." : failure.message);
    } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{complete ? "Kata sandi diperbarui" : "Lupa kata sandi?"}</CardTitle>
          <CardDescription>
            {complete ? "Kamu sekarang bisa masuk dengan kata sandi yang baru." : requested
              ? `Jika email ${email} terdaftar, kode pemulihan sudah dikirim. Masukkan kode tersebut untuk membuat kata sandi baru.`
              : "Masukkan Gmail akunmu. Kami akan mengirim kode pemulihan ke email tersebut."}
          </CardDescription>
        </CardHeader>
        {complete ? <CardFooter className="flex-col gap-3">
          <Button asChild className="w-full"><Link href="/login">Kembali ke masuk</Link></Button>
        </CardFooter> : requested ? <form onSubmit={resetPassword}>
          <CardContent className="space-y-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="reset-code">Kode dari email</Label>
              <Input id="reset-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Kata sandi baru</Label>
              <PasswordInput id="new-password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} />
              <p className="text-xs text-muted-foreground">Minimal 10 karakter.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Ulangi kata sandi baru</Label>
              <PasswordInput id="confirm-password" autoComplete="new-password" minLength={10} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6 || password.length < 10 || !confirmPassword}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</> : "Simpan kata sandi baru"}
            </Button>
            <Button type="button" variant="outline" className="w-full" disabled={busy || resendWait > 0} onClick={() => void sendCode()}>
              {resendWait > 0 ? `Kirim ulang kode (${resendWait} dtk)` : "Kirim ulang kode"}
            </Button>
            <button type="button" className="text-sm underline" onClick={() => { setRequested(false); setCode(""); setError(null); }}>Ganti email</button>
          </CardFooter>
        </form> : <form onSubmit={requestCode}>
          <CardContent className="space-y-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Untuk melindungi akun, halaman ini tidak mengungkapkan apakah email terdaftar.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy || !email}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Mengirim kode…</> : "Kirim kode pemulihan"}
            </Button>
            <p className="text-sm text-muted-foreground">Ingat kata sandi? <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Masuk</Link></p>
          </CardFooter>
        </form>}
      </Card>
    </AuthShell>
  );
}
