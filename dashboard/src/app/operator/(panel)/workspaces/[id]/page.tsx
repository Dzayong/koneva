"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { Card, FieldList } from "@/components/operator/field-list";
import { ErrorState, ForbiddenState, LoadingBlock } from "@/components/operator/page-state";
import { Progress } from "@/components/ui/progress";
import { useOperatorSession, useWorkspace } from "@/hooks/use-operator";
import { formatDate } from "@/lib/utils";

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground tabular-nums">{used.toLocaleString("id-ID")}{limit ? ` / ${limit.toLocaleString("id-ID")}` : ""}</span></div>
      {limit ? <Progress value={pct} aria-label={label} /> : null}
    </div>
  );
}

export default function WorkspacePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { can } = useOperatorSession();
  const ws = useWorkspace(id);

  if (!can("workspaces:read")) return <ForbiddenState />;
  if (ws.isLoading) return <LoadingBlock />;
  if (ws.error || !ws.data) return <ErrorState error={ws.error} onRetry={() => void ws.refetch()} />;
  const w = ws.data;

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />Kembali</button>
      <div><h1 className="text-2xl font-semibold tracking-tight">{w.name}</h1><p className="text-sm text-muted-foreground">Hanya baca. Status: {w.status || "—"}.</p></div>

      <Card title="Identitas">
        <FieldList items={[["Pemilik", w.owner ? `${w.owner.name} (${w.owner.email})` : null], ["Dibuat", w.created_at ? formatDate(w.created_at) : null], ["Status pelajar", w.student?.status ?? "Tidak ada pengajuan"]]} />
      </Card>

      <Card title="Langganan">
        {w.subscription ? (
          <FieldList items={[
            ["Paket", w.subscription.plan.name || w.subscription.plan.id], ["Status", w.subscription.status], ["Siklus", w.subscription.cycle ? (w.subscription.cycle === "yearly" ? "Tahunan" : "Bulanan") : null],
            ["Periode", w.subscription.period_start && w.subscription.period_end ? `${formatDate(w.subscription.period_start)} sampai ${formatDate(w.subscription.period_end)}` : null],
            ["Sisa hari", w.subscription.days_left === null ? null : String(w.subscription.days_left)],
          ]} />
        ) : <p className="text-sm text-muted-foreground">Belum ada langganan.</p>}
      </Card>

      <Card title="Pemakaian">
        <div className="grid gap-4 sm:grid-cols-3">
          <Usage label="Pesan bulan ini" used={w.usage.messages_used} limit={w.usage.messages_limit} />
          <Usage label="Device" used={w.usage.devices_used} limit={w.usage.devices_limit} />
          <Usage label="Anggota tim" used={w.usage.members_used} limit={w.usage.members_limit} />
        </div>
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Panel ini tidak menampilkan kunci API, secret webhook, kredensial, atau sesi WhatsApp, dan tidak punya aksi terhadap workspace.</p>
      <Link href="/operator" className="sr-only">Beranda operator</Link>
    </div>
  );
}
