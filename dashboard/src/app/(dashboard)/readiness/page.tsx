"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/use-me";
import { useBypassWorkspaceLevel, useConfirmWorkspaceMission, useRunWorkspaceTestMission, useWorkspaceReadiness } from "@/hooks/use-readiness-levels";
import { formatDate } from "@/lib/utils";

const BYPASS_COPY_VERSION = "level-bypass-v1" as const;

export default function ReadinessPage() {
  const readiness = useWorkspaceReadiness();
  const confirmMission = useConfirmWorkspaceMission();
  const runTest = useRunWorkspaceTestMission();
  const bypass = useBypassWorkspaceLevel();
  const { role } = usePermissions();
  const isOwner = role === "owner";
  const [targetLevel, setTargetLevel] = useState(0);
  const [reason, setReason] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [incidentAnswer, setIncidentAnswer] = useState("");

  const current = readiness.data;
  const target = current?.levels.find((item) => item.level === targetLevel);
  const canBypass = isOwner && current !== undefined && current.recommended_level !== null && targetLevel > current.recommended_level && reason.trim().length >= 5;
  const errorMessage = useMemo(() => {
    const error = confirmMission.error ?? runTest.error ?? bypass.error ?? readiness.error;
    return error instanceof Error ? error.message : error ? "Terjadi kesalahan. Coba muat ulang." : null;
  }, [bypass.error, confirmMission.error, runTest.error, readiness.error]);

  if (readiness.isLoading) return <div role="status" aria-label="Memuat Level & Misi" className="space-y-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-48 animate-pulse rounded-xl bg-muted" /></div>;
  if (!current) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"><h1 className="font-semibold">Level & Misi tidak dapat dimuat</h1><p className="mt-1 text-sm text-muted-foreground">{errorMessage ?? "Periksa koneksi Anda lalu coba lagi."}</p><Button className="mt-4" variant="outline" onClick={() => void readiness.refetch()}>Coba lagi</Button></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Level &amp; Misi</h1>
        <p className="mt-1 text-sm text-muted-foreground">Checklist kesiapan operasional workspace, berdasarkan bukti yang tersedia.</p>
      </header>

      <div className="rounded-xl border border-sky-300/50 bg-sky-50/70 p-4 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100">
        Level bukan persetujuan WhatsApp/Meta, prediksi pesan diterima, atau jaminan bebas pembatasan. Level tidak mengubah paket, kuota, rate limit, consent, opt-out, atau kontrol pengiriman.
      </div>

      {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{current.recommended_level === null ? "Belum ada level yang direkomendasikan" : <>Rekomendasi Level {current.recommended_level} · {current.levels[current.recommended_level]?.name}</>}</CardTitle>
          <p className="text-sm text-muted-foreground">{current.selected_by_owner ? `Level pilihan Owner: ${current.selected_level ?? "—"}. Rekomendasi berdasarkan checklist tetap ${current.recommended_level === null ? "belum tersedia" : `Level ${current.recommended_level}`}.` : current.recommended_level === null ? "Selesaikan kriteria Level 0 untuk mendapatkan rekomendasi." : "Level tertinggi dengan kriteria wajib yang sudah terpenuhi."}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {current.levels.map((level) => (
            <section key={level.level} aria-labelledby={`level-${level.level}`} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`level-${level.level}`} className="font-semibold">Level {level.level} · {level.name}</h2>
                <span className="text-xs text-muted-foreground">{level.completed}/{level.total} kriteria terpenuhi atau tidak relevan</span>
              </div>
              <ul className="space-y-2">
                {level.missions.map((mission) => {
                  const complete = mission.status !== "needs_action";
                  return (
                    <li key={mission.id} className="flex min-w-0 items-start gap-3 rounded-lg border p-3">
                      {complete ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{mission.title}{mission.status === "not_applicable" ? " · Tidak relevan untuk paket ini" : ""}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{mission.description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Sumber: {mission.source} · {mission.kind === "automatic" ? `Diperiksa ${formatDate(mission.observed_at)}` : mission.kind === "test" ? mission.confirmed_at ? `Simulasi terakhir ${formatDate(mission.confirmed_at)}` : "Belum dijalankan" : mission.confirmed_at ? `Dikonfirmasi ${formatDate(mission.confirmed_at)}` : "Menunggu konfirmasi Owner"}</p>
                        {mission.reason && <p className="mt-1 text-xs text-muted-foreground">{mission.reason}</p>}
                      </div>
                      {isOwner && mission.kind === "manual" && !complete && (
                        <Button size="sm" variant="outline" disabled={confirmMission.isPending} onClick={() => confirmMission.mutate(mission.id)}>Saya sudah meninjau</Button>
                      )}
                      {isOwner && mission.kind === "test" && (
                        <div className="flex flex-wrap items-center gap-2">
                          {mission.id === "incident_tabletop" && <label className="sr-only" htmlFor="incident-tabletop-answer">Pilihan tindakan simulasi insiden</label>}
                          {mission.id === "incident_tabletop" && <select id="incident-tabletop-answer" className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm" value={incidentAnswer} onChange={(event) => setIncidentAnswer(event.target.value)}><option value="">Pilih tindakan pada skenario</option><option value="pause_and_escalate">Jeda dan eskalasi</option><option value="resume_worker">Lanjutkan worker</option><option value="retry_queue">Kirim ulang antrean</option></select>}
                          <Button size="sm" variant="outline" disabled={runTest.isPending || (mission.id === "incident_tabletop" && !incidentAnswer)} onClick={() => runTest.mutate({ missionId: mission.id, ...(mission.id === "incident_tabletop" ? { answer: incidentAnswer } : {}) })}>{runTest.isPending ? "Menjalankan simulasi…" : complete ? "Jalankan ulang simulasi" : "Jalankan simulasi aman"}</Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="border-t pt-3 text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Diperbarui {formatDate(current.evaluated_at)}. Misi manual adalah konfirmasi Owner; bukan bukti bahwa pesan telah terkirim.</p>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader><CardTitle>Pilih level di atas rekomendasi</CardTitle><p className="text-sm text-muted-foreground">Ini hanya mengubah level pilihan yang ditampilkan. Kriteria yang belum terpenuhi tetap tercatat dan kontrol server tetap berlaku.</p></CardHeader>
          <CardContent className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="readiness-target">Level pilihan</label>
            <select id="readiness-target" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={targetLevel} onChange={(event) => setTargetLevel(Number(event.target.value))}>
              {current.levels.map((level) => <option key={level.level} value={level.level}>Level {level.level} · {level.name}{current.recommended_level !== null && level.level <= current.recommended_level ? " (rekomendasi saat ini atau di bawahnya)" : ""}</option>)}
            </select>
            <label className="block text-sm font-medium" htmlFor="readiness-reason">Alasan pilihan (minimal 5 karakter)</label>
            <Textarea id="readiness-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Jelaskan alasan memilih level ini" />
            <Button disabled={!canBypass || bypass.isPending} onClick={() => setDialogOpen(true)}>Tinjau dan pilih level</Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pilih level di atas rekomendasi?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">Level ini hanya mengubah checklist kesiapan yang ditampilkan. KONEVA tidak memverifikasi bahwa nomor disetujui WhatsApp/Meta atau menjamin pengiriman berhasil maupun bebas pembatasan.</span>
              <span className="block">Bypass tidak mengubah paket, kuota, rate limit, consent/opt-out, atau pemeriksaan penerima. Anda tetap bertanggung jawab memastikan penerima memberi izin.</span>
              <span className="block">Kriteria yang belum terpenuhi: {target?.missions.filter((mission) => mission.status === "needs_action").map((mission) => mission.title).join(", ") || "kriteria level sebelumnya yang belum selesai"}.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Kembali</Button>
            <Button disabled={!canBypass || bypass.isPending} onClick={() => {
              bypass.mutate({ target_level: targetLevel, reason: reason.trim(), dialog_version: BYPASS_COPY_VERSION, idempotency_key: crypto.randomUUID() }, { onSuccess: () => setDialogOpen(false) });
            }}>Pilih level ini</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
