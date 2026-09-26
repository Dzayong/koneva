"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
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
import type { InvitationPreview, Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", developer: "Developer", viewer: "Viewer" };

export default function InvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { loginWithSession, isAuthenticated } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<{ message: string; signIn?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.previewInvitation(token).then(setPreview).catch(() => setInvalid(true));
  }, [token]);

  const signedIn = isAuthenticated === true && api.hasSession();

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (signedIn) {
        const result = await api.acceptInvitation(token);
        api.setSession(api.getSession()!, result.joined.id);
        queryClient.clear();
        router.push("/dashboard");
        return;
      }
      const result = await api.acceptInvitation(token, { name: name.trim(), password, accept_terms: true });
      if (result.session) loginWithSession(result.session);
    } catch (err) {
      const failure = apiFailure(err);
      setError(
        failure.code === "ACCOUNT_EXISTS" ? { message: "Email ini sudah punya akun.", signIn: true }
        : failure.code === "EMAIL_MISMATCH" ? { message: "Undangan ini dikirim ke email yang berbeda dari akun yang sedang masuk." }
        : failure.code === "INVITATION_INVALID" ? { message: "Undangan ini sudah tidak berlaku." }
        : { message: failure.message },
      );
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <CardTitle>Undangan tidak berlaku</CardTitle>
            <CardDescription>Tautan ini sudah dipakai, kedaluwarsa, atau dibatalkan. Minta pengirimnya membuat undangan baru.</CardDescription>
          </CardHeader>
          <CardFooter><Button asChild variant="outline" className="w-full"><Link href="/login">Ke halaman masuk</Link></Button></CardFooter>
        </Card>
      </AuthShell>
    );
  }

  if (!preview) {
    return <AuthShell><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AuthShell>;
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Gabung ke {preview.workspace}</CardTitle>
          <CardDescription>
            {preview.invited_by ? `${preview.invited_by} mengundang Anda` : "Anda diundang"} sebagai <strong>{ROLE_LABEL[preview.role]}</strong>.
            Undangan ini untuk <span className="font-mono">{preview.email_hint}</span>.
          </CardDescription>
        </CardHeader>
        <form onSubmit={accept}>
          <CardContent className="space-y-4 pb-4">
            {signedIn ? (
              <p className="text-sm text-muted-foreground">Anda sedang masuk. Klik tombol di bawah untuk bergabung dengan akun ini.</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Nama</Label>
                  <Input id="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Kata sandi</Label>
                  <PasswordInput id="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Minimal 10 karakter.</p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-snug">
                  <input id="terms" type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
                  <span><TermsLabel /></span>
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error.message}{" "}
                {error.signIn && <Link href="/login" className="font-medium underline underline-offset-4">Masuk dulu, lalu buka tautan ini lagi</Link>}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={busy || (!signedIn && (!terms || password.length < 10 || !name.trim()))}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memproses…</> : signedIn ? "Terima undangan" : "Buat akun dan gabung"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </AuthShell>
  );
}
