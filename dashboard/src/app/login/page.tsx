"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";

export default function LoginPage() {
  const { loginWithSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      loginWithSession(await api.login(email.trim(), password));
    } catch (err) {
      const failure = apiFailure(err);
      setError(
        failure.status === 401 ? "Email atau kata sandi salah."
        : failure.status === 429 ? "Terlalu banyak percobaan. Coba lagi dalam 15 menit."
        : failure.message,
      );
      setBusy(false);
    }
  };

  return (
    <AuthShell background="login">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Masuk</CardTitle>
          <CardDescription>Masuk ke workspace Anda untuk mengelola nomor dan pesan.</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Kata sandi</Label>
              <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy || !email || !password}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Masuk…</> : "Masuk"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Belum punya akun?{" "}
              <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">Daftar</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthShell>
  );
}
