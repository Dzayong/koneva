"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";

const MESSAGE: Record<string, string> = {
  OTP_INVALID: "Kode salah, kedaluwarsa, atau sudah dipakai. Minta kode baru.",
  OTP_RATE_LIMITED: "Terlalu banyak permintaan kode. Coba lagi nanti.",
  OTP_CAPACITY_REACHED: "Pengiriman kode sedang dibatasi. Coba lagi nanti.",
  EMAIL_NOT_CONFIGURED: "Pengiriman email belum diaktifkan. Hubungi penyedia layanan.",
  EMAIL_DELIVERY_UNCERTAIN: "Status pengiriman belum pasti. Minta kode baru.",
};

/** Proves the account's mailbox. Needed before inviting people or ordering/paying; nothing else in the console waits for it. */
export function EmailVerificationDialog({ open, onOpenChange, onVerified }: { open: boolean; onOpenChange: (open: boolean) => void; onVerified?: () => void }) {
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const finish = () => { void queryClient.invalidateQueries({ queryKey: ["me"] }); onOpenChange(false); onVerified?.(); };
  const fail = (err: unknown) => { const f = apiFailure(err); setError((f.code ? MESSAGE[f.code] : undefined) ?? f.message); };

  const send = async () => {
    setError(null); setBusy(true);
    try {
      const result = await api.requestEmailVerification();
      if ("already_verified" in result) { finish(); return; }
      setSent(true); setWait(result.resend_after);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { await api.confirmEmailVerification(code); finish(); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verifikasi email Anda</DialogTitle>
          <DialogDescription>Kami kirim kode 6 digit ke alamat email akun ini. Verifikasi dibutuhkan sebelum mengundang anggota atau melakukan pembayaran. Fitur lain tidak terpengaruh.</DialogDescription>
        </DialogHeader>
        <form onSubmit={confirm} className="space-y-4">
          <Button type="button" variant="outline" onClick={send} disabled={busy || wait > 0}>
            {busy && !sent && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {sent ? (wait > 0 ? `Kirim ulang kode (${wait} dtk)` : "Kirim ulang kode") : "Kirim kode ke email"}
          </Button>
          {sent && (
            <div className="space-y-2">
              <Label htmlFor="verify-code">Kode verifikasi</Label>
              <Input id="verify-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || code.length !== 6}>Verifikasi</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
