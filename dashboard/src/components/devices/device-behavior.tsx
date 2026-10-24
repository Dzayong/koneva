"use client";

import { createContext, useContext, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronDown, Moon, Sun, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApplyPreset, useDeviceActivity, usePresets, useUpdatePersona } from "@/hooks/use-behavior";
import { usePermissions } from "@/hooks/use-me";
import { cn } from "@/lib/utils";
import type { DeviceActivity, Persona, Preset } from "@/lib/types";

const DeviceKeyContext = createContext("");
const useDeviceKey = () => useContext(DeviceKeyContext);

const seconds = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000}` : (ms / 1000).toFixed(1));
const toTime = (hour: number) => `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
const fromTime = (value: string) => {
  const [h = "0", m = "0"] = value.split(":");
  return Number(h) + Number(m) / 60;
};

function facts(p: Preset): string[] {
  const delay = p.delay_min_ms === p.delay_max_ms ? `${seconds(p.delay_min_ms)} dtk` : `${seconds(p.delay_min_ms)}–${seconds(p.delay_max_ms)} dtk`;
  return [p.always_on ? "Aktif 24 jam" : `Jam ${toTime(p.wake_hour)}–${toTime(p.sleep_hour)}`, `Jeda ${delay}`, `Istirahat tiap ±${p.burst_size} pesan`];
}

function PresetPicker({ presets, current, canEdit }: { presets: Preset[]; current: Persona["preset"]; canEdit: boolean }) {
  const apply = useApplyPreset(useDeviceKey());
  return (
    <div role="radiogroup" aria-label="Peran device" className="grid gap-3 md:grid-cols-3">
      {presets.map((p) => {
        const selected = current === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!canEdit || apply.isPending}
            onClick={() => !selected && apply.mutate(p.id)}
            className={cn(
              "relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed",
              selected ? "border-primary bg-accent" : "bg-card hover:border-primary/50 disabled:hover:border-border",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="font-medium">{p.label}</span>
              <motion.span
                initial={false}
                animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <Check className="h-3 w-3" />
              </motion.span>
            </span>
            <span className="text-sm text-muted-foreground">{p.description}</span>
            <ul className="mt-auto space-y-1 text-xs text-muted-foreground">
              {facts(p).map((f) => <li key={f} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-muted-foreground" />{f}</li>)}
            </ul>
          </button>
        );
      })}
    </div>
  );
}

function Advanced({ persona, canEdit, deviceKey }: { persona: Persona; canEdit: boolean; deviceKey: string }) {
  const update = useUpdatePersona(deviceKey);
  const [open, setOpen] = useState(false);
  const [alwaysOn, setAlwaysOn] = useState(persona.always_on);
  const [mode, setMode] = useState<"flat" | "random">(persona.delay_mode);
  const [flat, setFlat] = useState(seconds(persona.delay_min_ms));
  const [min, setMin] = useState(seconds(persona.delay_min_ms));
  const [max, setMax] = useState(seconds(persona.delay_max_ms));
  const [wake, setWake] = useState(toTime(persona.wake_hour));
  const [sleep, setSleep] = useState(toTime(persona.sleep_hour));
  const [presence, setPresence] = useState(persona.presence_enabled);
  const [typingEnabled, setTypingEnabled] = useState(persona.typing_enabled);
  const [pMin, setPMin] = useState(seconds(persona.presence_min_ms));
  const [pMax, setPMax] = useState(seconds(persona.presence_max_ms));

  const n = (v: string) => Math.round(Number(v) * 1000);
  const valid =
    (mode === "flat" ? n(flat) >= 1000 && n(flat) <= 600_000 : n(min) >= 1000 && n(max) >= n(min) && n(max) <= 600_000) &&
    (alwaysOn || fromTime(wake) < fromTime(sleep)) &&
    (!presence || (n(pMin) >= 1000 && n(pMax) >= n(pMin) && n(pMax) <= 600_000));

  const save = () => {
    update.mutate({
      always_on: alwaysOn,
      presence_enabled: presence,
      typing_enabled: typingEnabled,
      ...(presence ? { presence_min_ms: n(pMin), presence_max_ms: n(pMax) } : {}),
      ...(mode === "flat" ? { delay_ms: n(flat) } : { delay_min_ms: n(min), delay_max_ms: n(max) }),
      ...(alwaysOn ? {} : { wake_hour: fromTime(wake), sleep_hour: fromTime(sleep) }),
    });
  };

  return (
    <div className="rounded-lg border bg-card">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        Pengaturan lanjutan
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-5 border-t p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="always-on">Aktif 24 jam</Label>
              <p className="text-sm text-muted-foreground">Membalas dan mengirim kapan saja. Jika mati, nomor mengikuti jam aktifnya.</p>
            </div>
            <Switch id="always-on" checked={alwaysOn} onCheckedChange={setAlwaysOn} disabled={!canEdit} />
          </div>

          {!alwaysOn && (
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5"><Label htmlFor="wake">Mulai aktif</Label><Input id="wake" type="time" value={wake} onChange={(e) => setWake(e.target.value)} disabled={!canEdit} className="w-32" /></div>
              <div className="space-y-1.5"><Label htmlFor="sleep">Berhenti</Label><Input id="sleep" type="time" value={sleep} onChange={(e) => setSleep(e.target.value)} disabled={!canEdit} className="w-32" /></div>
            </div>
          )}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Jeda sebelum mengirim</legend>
            <div role="radiogroup" aria-label="Jenis jeda" className="inline-flex rounded-lg border p-0.5">
              {(["flat", "random"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!canEdit} onClick={() => setMode(m)}
                  className={cn("rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {m === "flat" ? "Tetap" : "Acak"}
                </button>
              ))}
            </div>
            {mode === "flat" ? (
              <div className="flex items-end gap-2"><div className="space-y-1.5"><Label htmlFor="flat">Detik</Label><Input id="flat" inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value)} disabled={!canEdit} className="w-28" /></div><p className="pb-2 text-sm text-muted-foreground">Setiap pesan menunggu persis waktu ini, termasuk membaca dan mengetik.</p></div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5"><Label htmlFor="min">Paling cepat (detik)</Label><Input id="min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} disabled={!canEdit} className="w-28" /></div>
                <div className="space-y-1.5"><Label htmlFor="max">Paling lama (detik)</Label><Input id="max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} disabled={!canEdit} className="w-28" /></div>
                <p className="pb-2 text-sm text-muted-foreground">Dipilih acak di antara keduanya setiap pesan.</p>
              </div>
            )}
            {!valid && <p role="alert" className="text-sm text-destructive">Periksa angka: jeda 1 detik sampai 10 menit, angka terbesar tidak boleh lebih kecil dari yang terkecil, dan jam berhenti harus setelah jam mulai.</p>}
          </fieldset>

          <fieldset className="space-y-3 border-t pt-5">
            <legend className="text-sm font-medium">Indikator mengetik</legend>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="typing-enabled">Tampilkan “sedang mengetik”</Label>
                <p className="text-sm text-muted-foreground">Mengatur indikator yang terlihat penerima. Jeda dan pengaturan pengiriman lain tetap berlaku.</p>
              </div>
              <Switch id="typing-enabled" checked={typingEnabled} onCheckedChange={setTypingEnabled} disabled={!canEdit} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 border-t pt-5">
            <legend className="text-sm font-medium">Membuka WhatsApp seperti orang</legend>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="presence">Online saat ada pesan masuk</Label>
                <p className="text-sm text-muted-foreground">Nomor menunggu sebentar, tampil online, menunggu lagi, membaca pesan (centang biru), lalu offline lagi. Saat membalas, nomor dipastikan online dulu.</p>
              </div>
              <Switch id="presence" checked={presence} onCheckedChange={setPresence} disabled={!canEdit} />
            </div>
            {presence && (
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5"><Label htmlFor="pmin">Jeda tiap tahap, paling cepat (detik)</Label><Input id="pmin" inputMode="decimal" value={pMin} onChange={(e) => setPMin(e.target.value)} disabled={!canEdit} className="w-28" /></div>
                <div className="space-y-1.5"><Label htmlFor="pmax">Paling lama (detik)</Label><Input id="pmax" inputMode="decimal" value={pMax} onChange={(e) => setPMax(e.target.value)} disabled={!canEdit} className="w-28" /></div>
                <p className="pb-2 text-sm text-muted-foreground">Setiap tahap memakai jeda acak dalam rentang ini. Centang biru hanya terlihat pengirim jika pengaturan “Tanda baca” di HP Anda aktif.</p>
              </div>
            )}
          </fieldset>

          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Pesan dengan prioritas <code>urgent</code> (misalnya OTP) selalu dikirim tanpa jeda ini.
          </p>
          <Button onClick={save} disabled={!canEdit || !valid || update.isPending}>{update.isPending ? "Menyimpan…" : "Simpan"}</Button>
        </div>
      )}
    </div>
  );
}

function Status({ activity }: { activity: DeviceActivity }) {
  const { today_window: w, fatigue: f, persona } = activity;
  const opens = w.opens_in_minutes;
  const restEnds = f.rest_ends_at ? new Date(f.rest_ends_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : null;
  const max = Math.max(1, ...activity.daily.map((d) => d.sent + d.received));
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div>
        <p className="text-label">Sekarang</p>
        <p className="mt-2 flex items-center gap-2 text-lg font-medium">
          {persona.always_on || w.open ? <Sun className="h-5 w-5 text-amber-500" /> : <Moon className="h-5 w-5 text-muted-foreground" />}
          {persona.always_on ? "Aktif 24 jam" : w.open ? `Aktif sampai ${w.end}` : "Istirahat malam"}
        </p>
        {!persona.always_on && !w.open && (
          <p className="mt-1 text-sm text-muted-foreground">Bangun pukul {w.start}, sekitar {opens >= 60 ? `${Math.floor(opens / 60)} jam ${opens % 60} menit` : `${opens} menit`} lagi.</p>
        )}
      </div>
      <div>
        <p className="text-label">Kelelahan</p>
        <p className="mt-2 flex items-center gap-2 text-lg font-medium"><Timer className="h-5 w-5 text-muted-foreground" />{f.resting ? `Istirahat${restEnds ? ` sampai ${restEnds}` : ""}` : "Segar"}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <motion.div className={cn("h-full rounded-full", f.resting ? "bg-amber-500" : "bg-primary")} initial={false}
            animate={{ width: `${Math.min(100, (f.burst_count / Math.max(1, f.burst_limit)) * 100)}%` }} transition={{ duration: 0.5 }} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Rentetan {f.burst_count} dari ±{f.burst_limit} pesan. Hanya pesan proaktif yang ikut istirahat.</p>
      </div>
      <div>
        <p className="text-label">Kebiasaan aktif</p>
        <p className="mt-2 text-lg font-medium tabular-nums">{activity.streak_days} hari berturut-turut</p>
        <div className="mt-2 flex h-10 items-end gap-1" role="img" aria-label="Aktivitas 14 hari terakhir">
          {activity.daily.map((d) => (
            <div key={d.date} title={`${d.date}: ${d.sent} keluar, ${d.received} masuk`} className="flex-1 rounded-sm bg-primary/70"
              style={{ height: `${Math.max(6, ((d.sent + d.received) / max) * 100)}%`, opacity: d.sent + d.received ? 1 : 0.25 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DeviceBehavior({ deviceKey }: { deviceKey: string }) {
  const { can } = usePermissions();
  const canEdit = can("devices:write");
  const presets = usePresets();
  const activity = useDeviceActivity(deviceKey);
  const persona = activity.data?.persona;

  return (
    <DeviceKeyContext.Provider value={deviceKey}>
      <div className="space-y-8">
        <section aria-labelledby="peran">
          <h3 id="peran" className="text-heading mb-1 text-lg">Peran device ini</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Pilih untuk apa nomor ini dipakai. Setiap nomor tetap mendapat sedikit variasi sendiri, jadi dua nomor dengan pilihan yang sama tidak berpola identik.
            {persona?.preset === "custom" && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">Sekarang: kustom</span>}
          </p>
          {presets.isLoading || !persona ? <Skeleton className="h-40 w-full" /> : <PresetPicker presets={presets.data ?? []} current={persona.preset} canEdit={canEdit} />}
          {!canEdit && <p className="mt-2 text-sm text-muted-foreground">Peran Anda hanya bisa melihat pengaturan ini.</p>}
        </section>

        {persona && <Advanced key={JSON.stringify(persona)} persona={persona} canEdit={canEdit} deviceKey={deviceKey} />}

        <section aria-labelledby="kondisi">
          <h3 id="kondisi" className="text-heading mb-4 text-lg">Kondisi saat ini</h3>
          {activity.isLoading ? <Skeleton className="h-28 w-full" /> : activity.data ? <Status activity={activity.data} /> : <p className="text-sm text-muted-foreground">Data belum tersedia.</p>}
        </section>
      </div>
    </DeviceKeyContext.Provider>
  );
}
