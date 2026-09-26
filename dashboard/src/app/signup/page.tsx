"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<{ message: string; taken?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordOk = password.length >= 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terms) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.signup({
        name: name.trim(), email: email.trim(), password,
        ...(workspace.trim() ? { workspace_name: workspace.trim() } : {}),
        accept_terms: true,
      });
      loginWithSession(result, "/dashboard?welcome=1");
    } catch (err) {
      const failure = apiFailure(err);
      setError(
        failure.code === "EMAIL_TAKEN" ? { message: "Email ini sudah terdaftar.", taken: true }
        : failure.status === 429 ? { message: "Terlalu banyak percobaan. Coba lagi nanti." }
        : failure.code === "SIGNUP_DISABLED" ? { message: "Pendaftaran sedang ditutup." }
        : { message: failure.message },
      );
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Buat akun</CardTitle>
          <CardDescription>Anda langsung mendapat workspace uji coba: 1 nomor dan 200 pesan.</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
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
            <Button type="submit" className="w-full" disabled={busy || !terms || !passwordOk || !name.trim() || !email}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Membuat akun…</> : "Buat akun"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Sudah punya akun?{" "}
              <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Masuk</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthShell>
  );
}
