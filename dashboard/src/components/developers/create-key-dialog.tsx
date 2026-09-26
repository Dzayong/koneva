"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateApiKey } from "@/hooks/use-developer";
import { usePermissions } from "@/hooks/use-me";
import { apiFailure } from "@/lib/errors";
import type { CreatedApiKey, Permission } from "@/lib/types";
import { cn } from "@/lib/utils";

export const SCOPE_LABEL: Record<string, string> = {
  "devices:read": "Lihat nomor",
  "devices:write": "Kelola nomor",
  "devices:delete": "Hapus nomor",
  "messages:read": "Baca pesan",
  "messages:send": "Kirim pesan",
  "content:write": "Ubah kontak, templat, dan balas otomatis",
  "webhooks:manage": "Atur webhook",
};

const PRESETS = [
  { id: "send", label: "Hanya kirim pesan", hint: "Untuk sistem yang cuma mengirim, misalnya OTP dan notifikasi.", scopes: ["messages:send"] },
  { id: "read", label: "Hanya baca", hint: "Untuk laporan atau dashboard yang melihat pesan dan status nomor.", scopes: ["messages:read", "devices:read"] },
  { id: "both", label: "Kirim dan baca", hint: "Untuk aplikasi yang mengirim lalu memeriksa hasilnya.", scopes: ["messages:send", "messages:read", "devices:read"] },
  { id: "custom", label: "Pilih sendiri", hint: "Centang izin satu per satu.", scopes: [] },
] as const;

const EXPIRY = [
  { value: "none", label: "Tidak kedaluwarsa" },
  { value: "30", label: "30 hari" },
  { value: "90", label: "90 hari" },
  { value: "365", label: "1 tahun" },
] as const;

export function CreateKeyDialog({
  open, onOpenChange, initialPreset = "send", initialName = "", onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPreset?: (typeof PRESETS)[number]["id"];
  initialName?: string;
  onCreated: (key: CreatedApiKey) => void;
}) {
  const { can } = usePermissions();
  const create = useCreateApiKey();
  const [name, setName] = useState(initialName);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>(initialPreset);
  const [custom, setCustom] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>("none");
  const [error, setError] = useState<string | null>(null);

  const chosen = preset === "custom" ? custom : [...(PRESETS.find((p) => p.id === preset)?.scopes ?? [])];
  const allowed = Object.keys(SCOPE_LABEL).filter((s) => can(s as Permission));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { name: name.trim(), scopes: chosen, ...(expiry !== "none" ? { expires_in_days: Number(expiry) } : {}) },
      {
        onSuccess: (key) => { onCreated(key); onOpenChange(false); setName(""); setCustom([]); },
        onError: (err) => setError(apiFailure(err).message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat kunci API</DialogTitle>
          <DialogDescription>Beri satu kunci untuk satu sistem, dengan izin sekecil yang dibutuhkan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="key-name">Nama kunci</Label>
            <Input id="key-name" required maxLength={80} placeholder="mis. Server OTP produksi" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Izin</legend>
            <div role="radiogroup" className="space-y-2">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => setPreset(p.id)}
                  className={cn("w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", preset === p.id ? "border-primary bg-accent" : "hover:border-primary/50")}>
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-muted-foreground">{p.hint}</span>
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {allowed.map((s) => (
                  <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={custom.includes(s)}
                      onChange={(e) => setCustom((c) => (e.target.checked ? [...c, s] : c.filter((x) => x !== s)))} />
                    {SCOPE_LABEL[s]}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="key-expiry">Masa berlaku</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger id="key-expiry" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{EXPIRY.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={create.isPending || !name.trim() || chosen.length === 0}>
            {create.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Membuat…</> : "Buat kunci"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
