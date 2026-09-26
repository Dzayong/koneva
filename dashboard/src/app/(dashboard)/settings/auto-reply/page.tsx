"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock, MessageSquare, Pencil, Plus, Reply, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "@/hooks/use-auto-reply";
import { apiErrorMessage } from "@/hooks/use-contacts";
import { useDevices } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { AutoReplyRule, AutoReplyTriggerType } from "@/lib/types";

const MAX_DELAY_SECONDS = 300; // backend CHECK: delay_ms <= 300000

const TRIGGER_STYLES: Record<AutoReplyTriggerType, string> = {
  keyword: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  regex: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  all: "bg-muted text-muted-foreground",
};

export default function AutoReplyPage() {
  const { data: rules, isLoading, isError } = useAutoReplyRules();
  const toggle = useToggleAutoReplyRule();
  const remove = useDeleteAutoReplyRule();
  const [dialog, setDialog] = useState<{ rule: AutoReplyRule | null } | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-heading">Auto-Reply Rules</h2>
          <p className="text-muted-foreground">Automatically respond to incoming messages.</p>
        </div>
        <Button onClick={() => setDialog({ rule: null })}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
        Bots load rules when they start — after changing rules, a device may need a restart before
        the change takes effect.
      </p>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 p-8 text-center text-sm text-destructive">
          Couldn&apos;t load auto-reply rules. The server may not support them yet.
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
          <h3 className="mt-4 text-lg font-semibold">No auto-reply rules</h3>
          <p className="mt-2 text-sm text-muted-foreground">Create your first rule to automate responses.</p>
          <Button variant="outline" className="mt-6" onClick={() => setDialog({ rule: null })}>
            <Plus className="mr-2 h-4 w-4" />
            Create Rule
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
                          {rule.trigger_type === "all" ? "Every incoming message" : rule.trigger_pattern}
                        </p>
                      </div>
                      <ArrowRight className="mx-auto h-5 w-5 rotate-90 text-primary md:rotate-0" />
                      <div className="rounded-xl bg-primary/8 p-3 ring-1 ring-primary/15">
                        <div className="flex items-center gap-2 text-xs font-medium text-primary">
                          <Reply className="h-3.5 w-3.5" />
                          Reply
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm">{rule.response_content}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {rule.delay_ms / 1000}s delay
                      </span>
                      <span>•</span>
                      <span>{rule.device_key}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <Switch
                      checked={rule.is_active}
                      disabled={toggle.isPending}
                      aria-label={rule.is_active ? "Disable rule" : "Enable rule"}
                      onCheckedChange={() => toggle.mutate(rule.id)}
                    />
                    <Button variant="ghost" size="icon" onClick={() => setDialog({ rule })}>
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm("Delete this auto-reply rule?")) remove.mutate(rule.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog?.rule ? "Edit Rule" : "Create Auto-Reply Rule"}</DialogTitle>
            <DialogDescription>Matching is case-insensitive.</DialogDescription>
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
function renderPreview(text: string): string {
  return text
    .replace(/\{([^{}|]+(?:\|[^{}]*)+)\}/g, (_, options: string) => options.split("|")[0] ?? "")
    .replace(/\{nama\}/gi, "Budi")
    .replace(/\{nomor\}/gi, "+62 812-3456-7890")
    .replace(/\{tanggal\}/gi, new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }));
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
  const [content, setContent] = useState(rule?.response_content ?? "");
  const [delaySeconds, setDelaySeconds] = useState(String((rule?.delay_ms ?? 3000) / 1000));

  const delay = Number(delaySeconds);
  const patternError =
    type === "regex" && pattern && !isValidRegex(pattern)
      ? "Invalid regular expression."
      : type !== "all" && !pattern.trim()
        ? "Pattern is required."
        : null;
  const delayError =
    !Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_SECONDS
      ? `Delay must be 0–${MAX_DELAY_SECONDS} seconds.`
      : null;
  const canSubmit = deviceKey && content.trim() && !patternError && !delayError;

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
          response_content: content,
          delay_ms: Math.round(delay * 1000),
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>Device</Label>
        <Select value={deviceKey} onValueChange={setDeviceKey}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select device" />
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
        <Label>Trigger type</Label>
        <Select value={type} onValueChange={(v) => setType(v as AutoReplyTriggerType)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyword">Keyword (message contains…)</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
            <SelectItem value="all">Catch all</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {type !== "all" && (
        <div className="space-y-2">
          <Label htmlFor="rule-pattern">{type === "keyword" ? "Keyword or phrase" : "Pattern"}</Label>
          <Input
            id="rule-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={type === "keyword" ? "harga" : "^(halo|hi)\\b"}
          />
          {type === "keyword" && (
            <p className="text-xs text-muted-foreground">
              One phrase — the rule fires when the message contains it. For several words use Regex,
              e.g. <code>halo|hi|hello</code>.
            </p>
          )}
          {patternError && <p className="text-sm text-destructive">{patternError}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="rule-content">Response message</Label>
        <Textarea
          id="rule-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="Halo {nama}! Ada yang bisa kami bantu?"
        />
        <p className="text-xs text-muted-foreground">
          Variables: {"{nama}"}, {"{nomor}"}, {"{tanggal}"} · Spintax: {"{Halo|Hai|Hi}"}
        </p>
      </div>

      {content.trim() && (
        <div className="space-y-2">
          <Label>Preview</Label>
          <div className="rounded-2xl bg-muted/60 p-4">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-lg bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground shadow-sm">
              {renderPreview(content)}
            </p>
            <p className="mt-2 text-right text-xs text-muted-foreground">Sample values — {delaySeconds || 0}s after the message arrives</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="rule-delay">Delay (seconds)</Label>
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
        <p className="text-sm text-destructive">{apiErrorMessage(save.error, "Failed to save rule.")}</p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" className="flex-1" disabled={save.isPending || !canSubmit}>
          {save.isPending ? "Saving..." : rule ? "Update Rule" : "Create Rule"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
