"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock, Eye, MessageSquare, Pencil, Plus, Reply, Trash2, X, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useAutoReplyRules,
  useDeleteAutoReplyRule,
  useSaveAutoReplyRule,
  useToggleAutoReplyRule,
  useUpdateWorkspaceSendHours,
  useWorkspaceSendHours,
} from "@/hooks/use-auto-reply";
import { apiErrorMessage } from "@/hooks/use-contacts";
import { useDevices } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { AutoReplyRule, AutoReplyTriggerType, AutoReplyDestinationScope } from "@/lib/types";

const MAX_DELAY_SECONDS = 300; // backend CHECK: delay_ms <= 300000

const TRIGGER_STYLES: Record<AutoReplyTriggerType, string> = {
  keyword: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  regex: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  all: "bg-muted text-muted-foreground",
};

const AI_SKILLS = [
  { id: "customer_service", name: "CS ramah", description: "Menjawab pelanggan dengan ramah, jelas, dan empatik." },
  { id: "shop_assistant", name: "Asisten toko", description: "Membantu menjelaskan produk dan langkah pemesanan tanpa mengarang harga atau stok." },
  { id: "faq_helper", name: "Penjawab FAQ", description: "Menjawab dari informasi usaha yang kamu isi; mengakui jika jawabannya belum tersedia." },
  { id: "research_context", name: "Analisis informasi", description: "Menganalisis konteks yang tersedia. Skill ini tidak mencari informasi di internet." },
] as const;

export default function AutoReplyPage() {
  const { data: rules, isLoading, isError } = useAutoReplyRules();
  const toggle = useToggleAutoReplyRule();
  const remove = useDeleteAutoReplyRule();
  const [dialog, setDialog] = useState<{ rule: AutoReplyRule | null } | null>(null);
  const workHours = useWorkspaceSendHours();
  const saveHours = useUpdateWorkspaceSendHours();
  const [hoursDraft, setHoursDraft] = useState<{ enabled: boolean; startTime: string; endTime: string } | null>(null);
  const hoursEnabled = hoursDraft?.enabled ?? workHours.data?.enabled ?? true;
  const startTime = hoursDraft?.startTime ?? workHours.data?.start_time ?? "08:00";
  const endTime = hoursDraft?.endTime ?? workHours.data?.end_time ?? "22:00";
  const updateHoursDraft = (patch: Partial<NonNullable<typeof hoursDraft>>) => {
    setHoursDraft((current) => ({ enabled: hoursEnabled, startTime, endTime, ...current, ...patch }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-heading">Aturan balas otomatis</h2>
          <p className="text-muted-foreground">Balas pesan masuk secara otomatis.</p>
        </div>
        <Button onClick={() => setDialog({ rule: null })}>
          <Plus className="mr-2 h-4 w-4" />
          Tambah aturan
        </Button>
      </div>

      <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
        Perubahan aturan berlaku beberapa detik setelah disimpan. Cakupan tujuan menentukan apakah aturan berjalan di grup, chat pribadi, atau keduanya.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Jam kerja workspace</CardTitle>
          <p className="text-sm text-muted-foreground">Jadwal ini berlaku untuk balas otomatis dan broadcast. Pengiriman melalui API tidak mengikuti jadwal ini. Zona waktu WIB.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {workHours.isError ? <p className="text-sm text-destructive">Jam kerja tidak bisa dimuat. Muat ulang halaman.</p> : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="workspace-hours-enabled">Batasi balas otomatis dan broadcast dengan jam kerja</Label>
                  <p className="text-sm text-muted-foreground">Pesan broadcast di luar jam ini menunggu sampai jadwal dibuka.</p>
                </div>
                <Switch id="workspace-hours-enabled" checked={hoursEnabled} onCheckedChange={(enabled) => updateHoursDraft({ enabled })} disabled={!workHours.data || saveHours.isPending} />
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5"><Label htmlFor="workspace-hours-start">Mulai</Label><Input id="workspace-hours-start" type="time" value={startTime} onChange={(event) => updateHoursDraft({ startTime: event.target.value })} disabled={!hoursEnabled || !workHours.data || saveHours.isPending} className="w-36" /></div>
                <div className="space-y-1.5"><Label htmlFor="workspace-hours-end">Selesai</Label><Input id="workspace-hours-end" type="time" value={endTime} onChange={(event) => updateHoursDraft({ endTime: event.target.value })} disabled={!hoursEnabled || !workHours.data || saveHours.isPending} className="w-36" /></div>
                <Button disabled={!workHours.data || saveHours.isPending || (hoursEnabled && startTime >= endTime)} onClick={() => saveHours.mutate({ enabled: hoursEnabled, start_time: startTime, end_time: endTime })}>
                  {saveHours.isPending ? "Menyimpan…" : "Simpan jam kerja"}
                </Button>
              </div>
              {hoursEnabled && startTime >= endTime && <p role="alert" className="text-sm text-destructive">Jam selesai harus setelah jam mulai.</p>}
            </>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 p-8 text-center text-sm text-destructive">
          Aturan balas otomatis tidak bisa dimuat. Muat ulang halaman.
        </div>
      ) : rules && rules.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-20"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Belum ada aturan balas otomatis</h3>
          <p className="mt-2 text-sm text-muted-foreground">Buat aturan pertama untuk membalas pesan secara otomatis.</p>
          <Button variant="outline" className="mt-6" onClick={() => setDialog({ rule: null })}>
            <Plus className="mr-2 h-4 w-4" />
            Buat aturan
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {rules?.map((rule) => (
              <motion.div
                key={rule.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: rule.is_active ? 1 : 0.6, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="surface rounded-2xl border p-5 sm:p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1.4fr] md:items-center">
                      <div className="rounded-xl bg-muted/60 p-3">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Zap className="h-3.5 w-3.5" />
                          When
                          <Badge className={cn("border-0", TRIGGER_STYLES[rule.trigger_type])}>{rule.trigger_type}</Badge>
                        </div>
                        <p className="mt-1.5 font-mono text-sm break-all">
                          {rule.trigger_type === "all" ? "Setiap pesan masuk" : rule.trigger_pattern}
                        </p>
                      </div>
                      <ArrowRight className="mx-auto h-5 w-5 rotate-90 text-primary md:rotate-0" />
                      <div className="rounded-xl bg-primary/8 p-3 ring-1 ring-primary/15">
                        <div className="flex items-center gap-2 text-xs font-medium text-primary">
                          <Reply className="h-3.5 w-3.5" />
                          Reply
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm">{rule.response_type === "ai_general" ? "AI umum · jawaban ringkas dan relevan" : rule.response_type === "ai" ? [
                          ...(rule.response_config?.skill_ids ?? []).map((id) => AI_SKILLS.find((skill) => skill.id === id)?.name).filter(Boolean),
                          rule.response_content ? "Instruksi manual" : "",
                        ].filter(Boolean).join(" + ") || "Instruksi manual" : rule.response_content}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {rule.delay_ms / 1000}s delay
                      </span>
                      <span>•</span>
                      <span>{rule.device_key}</span>
                      <span>•</span>
                      <Badge variant="outline" className="text-xs">{rule.destination_scope === "all" ? "Semua" : rule.destination_scope === "private" ? "Pribadi" : "Grup"}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <Switch
                      checked={rule.is_active}
                      disabled={toggle.isPending}
                      aria-label={rule.is_active ? "Matikan aturan" : "Nyalakan aturan"}
                      onCheckedChange={() => toggle.mutate(rule.id)}
                    />
                    <Button variant="ghost" size="icon" onClick={() => setDialog({ rule })}>
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Ubah</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm("Hapus aturan balas otomatis ini?")) remove.mutate(rule.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Hapus</span>
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog?.rule ? "Ubah aturan" : "Buat aturan balas otomatis"}</DialogTitle>
            <DialogDescription>Pencocokan tidak membedakan huruf besar dan kecil.</DialogDescription>
          </DialogHeader>
          {/* Keyed so each open starts from that rule's values, not the previous form's. */}
          {dialog && (
            <RuleForm key={dialog.rule?.id ?? "new"} rule={dialog.rule} onDone={() => setDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Sample render for the preview: first spintax option, example variable values. */
function renderPreview(text: string, customVariables: Record<string, string> = {}): string {
  return text
    .replace(/\{([^{}|]+(?:\|[^{}]*)+)\}/g, (_, options: string) => options.split("|")[0] ?? "")
    .replace(/\{nama\}/gi, "Budi")
    .replace(/\{nomor\}/gi, "+62 812-3456-7890")
    .replace(/\{tanggal\}/gi, new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }))
    .replace(/\{([a-z][a-z0-9_]*)\}/gi, (original, key: string) => customVariables[key.toLocaleLowerCase()] || original);
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

function RuleForm({ rule, onDone }: { rule: AutoReplyRule | null; onDone: () => void }) {
  const { data: devices } = useDevices();
  const save = useSaveAutoReplyRule();
  const [deviceKey, setDeviceKey] = useState(rule?.device_key ?? "");
  const [type, setType] = useState<AutoReplyTriggerType>(rule?.trigger_type ?? "keyword");
  const [pattern, setPattern] = useState(rule?.trigger_pattern ?? "");
  const [responseType, setResponseType] = useState<"text" | "ai_general" | "ai">(rule?.response_type === "ai" || rule?.response_type === "ai_general" ? rule.response_type : "text");
  const [textContent, setTextContent] = useState(rule?.response_type === "ai" || rule?.response_type === "ai_general" ? "" : rule?.response_content ?? "");
  const [aiPrompt, setAiPrompt] = useState(rule?.response_type === "ai" ? rule.response_content : "");
  const [skillIds, setSkillIds] = useState<string[]>(rule?.response_config?.skill_ids ?? []);
  const [replyToTrigger, setReplyToTrigger] = useState(rule?.response_config?.reply_to_trigger ?? true);
  const [destinationScope, setDestinationScope] = useState<AutoReplyDestinationScope>(rule?.destination_scope ?? "all");
  const [variables, setVariables] = useState<Record<string, string>>(rule?.response_config?.variables ?? {});
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const content = responseType === "ai" ? aiPrompt : responseType === "ai_general" ? "" : textContent;
  const [delaySeconds, setDelaySeconds] = useState(String((rule?.delay_ms ?? 3000) / 1000));

  const delay = Number(delaySeconds);
  const patternError =
    type === "regex" && pattern && !isValidRegex(pattern)
      ? "Ekspresi reguler tidak valid."
      : type !== "all" && !pattern.trim()
        ? "Pola wajib diisi."
        : null;
  const delayError =
    !Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_SECONDS
      ? `Jeda harus 0–${MAX_DELAY_SECONDS} detik.`
      : null;
  const aiConfigured = responseType === "ai_general" || (responseType === "ai" && (aiPrompt.trim().length > 0 || skillIds.length > 0));
  const canSubmit = deviceKey && (responseType === "text" ? content.trim().length > 0 : aiConfigured) && !patternError && !delayError;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    save.mutate(
      {
        id: rule?.id,
        data: {
          device_key: deviceKey,
          trigger_type: type,
          trigger_pattern: type === "all" ? "" : pattern.trim(),
          response_type: responseType,
          response_content: content,
          response_config: {
            skill_ids: responseType === "ai" ? skillIds : [],
            variables: responseType === "ai" ? variables : {},
            reply_to_trigger: replyToTrigger,
          },
          destination_scope: destinationScope,
          delay_ms: Math.round(delay * 1000),
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nomor</Label>
        <Select value={deviceKey} onValueChange={setDeviceKey}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pilih device" />
          </SelectTrigger>
          <SelectContent>
            {devices?.map((d) => (
              <SelectItem key={d.device_key} value={d.device_key}>
                {d.label || d.device_key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Cakupan tujuan</Label>
        <Select value={destinationScope} onValueChange={(v) => setDestinationScope(v as AutoReplyDestinationScope)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="group">Grup &amp; komunitas</SelectItem>
            <SelectItem value="private">Chat pribadi</SelectItem>
            <SelectItem value="all">Semua chat</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Tentukan apakah aturan ini berjalan di grup, chat pribadi, atau keduanya.</p>
      </div>

      <div className="space-y-2">
        <Label>Jenis pemicu</Label>
        <Select value={type} onValueChange={(v) => setType(v as AutoReplyTriggerType)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyword">Kata kunci (pesan mengandung…)</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
            <SelectItem value="all">Semua pesan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Jenis balasan</Label>
        <Select value={responseType} onValueChange={(value) => setResponseType(value as typeof responseType)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Balasan tetap</SelectItem>
            <SelectItem value="ai_general">AI umum</SelectItem>
            <SelectItem value="ai">AI dengan instruksi dan skill</SelectItem>
          </SelectContent>
        </Select>
        {responseType !== "text" && <p className="text-xs text-muted-foreground">API key dan model dikelola admin sistem. AI hanya dipanggil saat pemicu cocok.</p>}
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
        <Switch checked={replyToTrigger} onCheckedChange={setReplyToTrigger} aria-label="Balas pesan pemicu" />
        <span>
          <span className="block text-sm font-medium">Kutip pesan yang cocok dengan pemicu</span>
          <span className="block text-xs text-muted-foreground">Balasan Djoko akan tampil sebagai “Balas” pada pesan yang cocok. Ini tidak mengubah kata pemicu yang harus ada di pesan baru.</span>
        </span>
      </label>

      {type !== "all" && (
        <div className="space-y-2">
          <Label htmlFor="rule-pattern">{type === "keyword" ? "Kata kunci atau frasa" : "Pola"}</Label>
          <Input
            id="rule-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={type === "keyword" ? "harga" : "^(halo|hi)\\b"}
          />
          {type === "keyword" && (
            <p className="text-xs text-muted-foreground">
              Satu frasa: aturan berjalan bila pesan mengandungnya. Untuk beberapa kata gunakan Regex,
              mis. <code>halo|hi|hello</code>.
            </p>
          )}
          {patternError && <p className="text-sm text-destructive">{patternError}</p>}
        </div>
      )}

      <div className="space-y-2">
        {responseType !== "ai_general" && <>
        <Label htmlFor="rule-content">{responseType === "ai" ? "Instruksi tambahan (opsional jika memilih skill)" : "Isi balasan"}</Label>
        <Textarea
          id="rule-content"
          value={content}
          onChange={(e) => responseType === "ai" ? setAiPrompt(e.target.value) : setTextContent(e.target.value)}
          rows={4}
          placeholder={responseType === "ai" ? "Contoh: Gunakan bahasa santai. Arahkan pelanggan melihat katalog sebelum bertanya harga." : "Halo {nama}! Ada yang bisa kami bantu?"}
        />
        <p className="text-xs text-muted-foreground">
          {responseType === "ai" ? <>Tulis aturan khusus. Gunakan <code className="rounded bg-muted px-1">{`{{variabel}}`}</code> untuk menyisipkan data usaha.</> : <>Variabel: {"{nama}"} · Spintax: {"{Halo|Hai|Hi}"}</>}
        </p>
        </>}
      </div>

      {responseType === "ai" && (
        <div className="space-y-3 rounded-xl border p-3">
          <div>
            <Label>Skill balasan</Label>
            <p className="mt-1 text-xs text-muted-foreground">Pilih satu atau beberapa playbook. Skill bisa dipakai sendiri atau digabung dengan instruksi manual.</p>
          </div>
          <div className="space-y-2">
            {AI_SKILLS.map((skill) => {
              const checked = skillIds.includes(skill.id);
              return (
                <label key={skill.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setSkillIds((current) => event.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id))}
                    className="mt-1 h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{skill.name}</span>
                    <span className="block text-xs text-muted-foreground">{skill.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="space-y-2 border-t pt-3">
            {skillIds.length === 0 && !aiPrompt.trim() && <p className="text-xs text-destructive">Pilih minimal satu skill atau isi instruksi manual.</p>}
          </div>

          <div className="space-y-3 border-t pt-3">
            <div>
              <Label>Variabel usaha</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Data usaha yang AI gunakan untuk menjawab. Gunakan <code className="rounded bg-muted px-1">{`{{nama_var}}`}</code> di instruksi.
                Variabel <code className="rounded bg-muted px-1">nama</code>, <code className="rounded bg-muted px-1">nomor</code>, dan <code className="rounded bg-muted px-1">nama_toko</code> sudah otomatis terisi.
              </p>
            </div>
            {Object.entries(variables).length > 0 && (
              <div className="space-y-2">
                {Object.entries(variables).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="shrink-0 rounded bg-muted px-2 py-1 text-xs">{key}</code>
                    <Input
                      value={value}
                      onChange={(e) => setVariables((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="flex-1 text-sm"
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => setVariables((prev) => { const next = { ...prev }; delete next[key]; return next; })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(variables).length < 12 && (
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nama</Label>
                  <Input value={newVarKey} onChange={(e) => setNewVarKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="harga_paket" className="w-36 text-sm" />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nilai</Label>
                  <Input value={newVarValue} onChange={(e) => setNewVarValue(e.target.value)} placeholder="Rp 99.000/bulan" className="text-sm" />
                </div>
                <Button type="button" variant="outline" size="sm" disabled={!newVarKey || !newVarValue.trim() || ["nama", "nomor", "tanggal", "nama_toko"].includes(newVarKey) || newVarKey in variables}
                  onClick={() => { setVariables((prev) => ({ ...prev, [newVarKey]: newVarValue })); setNewVarKey(""); setNewVarValue(""); }}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Tambah
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {(responseType === "ai" || responseType === "ai_general") && (
        <>
          <Button type="button" variant="outline" size="sm" className="w-full"
            disabled={previewLoading}
            onClick={async () => {
              setPreviewLoading(true);
              try {
                const result = await api.previewAiPrompt({
                  response_type: responseType as "ai" | "ai_general",
                  response_content: content,
                  response_config: { skill_ids: responseType === "ai" ? skillIds : [], variables: responseType === "ai" ? variables : {} },
                });
                setPreviewText(result.instruction);
              } catch { setPreviewText("Gagal memuat pratinjau."); }
              setPreviewLoading(false);
            }}>
            <Eye className="mr-2 h-4 w-4" />
            {previewLoading ? "Memuat…" : "Pratinjau prompt AI"}
          </Button>

          {previewText !== null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Pratinjau system instruction</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setPreviewText(null)}>Tutup</Button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">{previewText}</pre>
            </div>
          )}
        </>
      )}

      {responseType === "text" && content.trim() && (
        <div className="space-y-2">
          <Label>Pratinjau</Label>
          <div className="rounded-2xl bg-muted/60 p-4">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-lg bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground shadow-sm">
              {renderPreview(content)}
            </p>
            <p className="mt-2 text-right text-xs text-muted-foreground">Nilai contoh, dikirim {delaySeconds || 0} dtk setelah pesan masuk</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="rule-delay">Jeda (detik)</Label>
        <Input
          id="rule-delay"
          type="number"
          min={0}
          max={MAX_DELAY_SECONDS}
          step={0.5}
          value={delaySeconds}
          onChange={(e) => setDelaySeconds(e.target.value)}
        />
        {delayError && <p className="text-sm text-destructive">{delayError}</p>}
      </div>

      {save.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(save.error, "Gagal menyimpan aturan.")}</p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" className="flex-1" disabled={save.isPending || !canSubmit}>
          {save.isPending ? "Menyimpan..." : rule ? "Simpan perubahan" : "Buat aturan"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
      </div>
    </form>
  );
}
