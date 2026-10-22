"use client";

import { useState } from "react";
import { Bot, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { useAiReplySettings, useOperatorSession, useSaveAiReplySettings } from "@/hooks/use-operator";
import type { AiReplyProviderSettings } from "@/lib/operator/types";

export default function AiReplyProviderPage() {
  const { can } = useOperatorSession();
  const settings = useAiReplySettings(can("owner:insights"));
  if (!can("owner:insights")) return <ForbiddenState text="Pengaturan ini hanya untuk superadmin." />;
  if (settings.isLoading) return <LoadingBlock label="Memuat konfigurasi provider AI..." />;
  if (settings.error || !settings.data) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  return <AiReplySettingsForm initial={settings.data} />;
}

function AiReplySettingsForm({ initial }: { initial: AiReplyProviderSettings }) {
  const save = useSaveAiReplySettings();
  const [baseUrl, setBaseUrl] = useState(initial.base_url || "https://api.openai.com/v1");
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [configured, setConfigured] = useState(initial.configured);
  const [showKey, setShowKey] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try { await save.mutateAsync({ base_url: baseUrl, model, ...(apiKey ? { api_key: apiKey } : {}), enabled }); }
    catch { return; }
    setApiKey("");
    setConfigured(true);
  };

  return <div className="mx-auto max-w-4xl space-y-6">
    <header>
      <p className="text-label text-primary">PENGATURAN SISTEM</p>
      <h1 className="text-display mt-2">Provider balasan AI</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">Superadmin mengatur provider, model, dan API key di sini. Pengguna workspace hanya mengisi prompt peran AI pada aturan balasan otomatis; kredensial ini tidak pernah ditampilkan ke mereka.</p>
    </header>

    <Card className="space-y-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary"><Bot className="h-5 w-5" aria-hidden /></div>
          <div><h2 className="font-semibold">Provider kompatibel OpenAI</h2><p className="text-sm text-muted-foreground">Kunci disimpan terenkripsi di database.</p></div>
        </div>
        <Badge variant={enabled ? "default" : "outline"}>{enabled ? "Aktif" : "Nonaktif"}</Badge>
      </div>

      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1.5 text-sm font-medium">URL dasar provider
          <input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" />
          <span className="block text-xs font-normal text-muted-foreground">Provider harus mendukung endpoint chat completions dan memakai HTTPS.</span>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">Nama model
          <input required maxLength={160} value={model} onChange={(event) => setModel(event.target.value)} placeholder="Contoh: gpt-4o-mini" className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">API key provider
          <span className="flex gap-2">
            <input required={!configured} autoComplete="new-password" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured ? "Tersimpan aman; isi hanya untuk mengganti" : "Tempel API key provider"} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-normal" />
            <Button type="button" variant="outline" size="icon" aria-label={showKey ? "Sembunyikan API key" : "Tampilkan API key"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
          </span>
          <span className="block text-xs font-normal text-muted-foreground">Kunci tidak dapat dibaca kembali dari halaman. Kosongkan untuk mempertahankan kunci yang sudah tersimpan.</span>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Aktifkan balasan AI untuk aturan yang memilih mode AI</label>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">AI hanya dipanggil ketika kata pemicu aturan cocok pada pesan grup atau komunitas yang diikuti device. Balasan tetap tunduk pada guard pengiriman KONEVA.</div>
        <Button type="submit" disabled={save.isPending || (!configured && !apiKey)}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}Simpan konfigurasi
        </Button>
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p role="status" className="text-sm text-success">Konfigurasi tersimpan. API key tidak ditampilkan kembali.</p>}
      </form>
    </Card>
  </div>;
}
