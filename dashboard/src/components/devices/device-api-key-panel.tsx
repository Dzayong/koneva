"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey } from "@/hooks/use-developer";
import { usePermissions } from "@/hooks/use-me";
import { apiFailure } from "@/lib/errors";
import type { CreatedApiKey } from "@/lib/types";

export function DeviceApiKeyPanel({ deviceKey, deviceLabel }: { deviceKey: string; deviceLabel: string }) {
  const { can } = usePermissions();
  const keys = useApiKeys(deviceKey);
  const create = useCreateApiKey();
  const rotate = useRotateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState(`${deviceLabel} integration`);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!can("keys:manage")) return <p className="text-sm text-muted-foreground">Peran Anda tidak dapat mengelola kunci API.</p>;
  const live = (keys.data?.keys ?? []).filter((key) => !key.revoked_at && (!key.expires_at || new Date(key.expires_at) > new Date()));
  const current = live[0];
  const createKey = () => {
    setError(null);
    create.mutate({ name: name.trim(), device_key: deviceKey, scopes: ["messages:send", "messages:read", "devices:read"] }, {
      onSuccess: setCreated,
      onError: (cause) => setError(apiFailure(cause).message),
    });
  };
  const rotateKey = () => {
    if (!current) return;
    setError(null);
    rotate.mutate(current.id, { onSuccess: setCreated, onError: (cause) => setError(apiFailure(cause).message) });
  };
  const revokeKey = () => {
    if (!current || !window.confirm(`Cabut kunci untuk ${deviceLabel}? Integrasi yang memakainya akan berhenti.`)) return;
    setError(null);
    revoke.mutate(current.id, { onError: (cause) => setError(apiFailure(cause).message) });
  };

  return (
    <section className="max-w-3xl space-y-5 rounded-2xl border bg-card p-6 shadow-card">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><KeyRound className="h-5 w-5" aria-hidden /></div>
        <div>
          <h3 className="font-semibold">API key device</h3>
          <p className="mt-1 text-sm text-muted-foreground">Kunci ini dibatasi ke device ini. Simpan rahasianya di server integrasi dan jangan bagikan ke browser atau chat.</p>
        </div>
      </div>

      {keys.isLoading ? <p className="text-sm text-muted-foreground">Memeriksa kunci…</p> : keys.isError ? (
        <p role="alert" className="text-sm text-destructive">Gagal memuat kunci. Muat ulang halaman.</p>
      ) : current ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <p className="font-medium">{current.name}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{current.prefix}… · Terikat ke {deviceKey}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={rotateKey} disabled={rotate.isPending}>
              {rotate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}Putar
            </Button>
            <Button variant="destructive" size="sm" onClick={revokeKey} disabled={revoke.isPending}>
              {revoke.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Cabut
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">Belum ada key khusus untuk device ini. Key workspace lama tetap berfungsi sesuai izinnya.</p>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Nama API key" value={name} onChange={(event) => setName(event.target.value)} className="max-w-sm" maxLength={80} />
            <Button onClick={createKey} disabled={create.isPending || !name.trim()}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Buat API key
            </Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Izin default: kirim pesan, baca status pesan, dan baca device. Kelola semua kunci dari <Link className="underline underline-offset-4" href="/developers/keys">halaman Kunci API</Link>.</p>
      {created && <SecretReveal open title="API key dibuat" description={`Kunci untuk ${deviceLabel} hanya ditampilkan sekali.`} secret={created.key} onDone={() => { setCreated(null); void keys.refetch(); }} />}
    </section>
  );
}
