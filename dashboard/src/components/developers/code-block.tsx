"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface CodeTab { id: string; label: string; code: string }

/** Dark code panel with language tabs and a one-click copy; the same look as the landing page terminal. */
export function CodeBlock({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const [copied, setCopied] = useState(false);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  const copy = async () => {
    const ok = await copyText(tab.code);
    setCopied(ok);
    if (ok) { toast.success("Kode tersalin"); setTimeout(() => setCopied(false), 1800); }
    else toast.error("Tidak bisa menyalin otomatis", { description: "Pilih teksnya lalu salin manual." });
  };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-2">
        <div role="tablist" className="flex">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tab.id} type="button" onClick={() => setActive(t.id)}
              className={cn("px-3 py-2.5 text-xs font-medium transition-colors", t.id === tab.id ? "text-white" : "text-slate-500 hover:text-slate-300")}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} className="mr-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Tersalin" : "Salin"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-slate-200"><code className="!rounded-none !bg-transparent !px-0 !py-0 !text-inherit">{tab.code}</code></pre>
    </div>
  );
}
