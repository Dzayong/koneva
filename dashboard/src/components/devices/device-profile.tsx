"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useProfile, useSetPicture, useUpdateProfile } from "@/hooks/use-business";
import { businessErrorText } from "@/lib/business-errors";
import { resizeToJpegBase64 } from "@/lib/image-resize";
import type { BusinessHoursDay, DeviceProfile } from "@/lib/types";

const DAYS: Array<{ id: BusinessHoursDay["day"]; label: string }> = [
  { id: "mon", label: "Senin" }, { id: "tue", label: "Selasa" }, { id: "wed", label: "Rabu" }, { id: "thu", label: "Kamis" },
  { id: "fri", label: "Jumat" }, { id: "sat", label: "Sabtu" }, { id: "sun", label: "Minggu" },
];
type Row = { mode: "closed" | BusinessHoursDay["mode"]; open: string; close: string };

function Photo({ deviceKey, profile, canEdit }: { deviceKey: string; profile: DeviceProfile; canEdit: boolean }) {
  const set = useSetPicture(deviceKey);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) { setError("Pilih berkas gambar (JPG atau PNG)."); return; }
    try {
      const b64 = await resizeToJpegBase64(file);
      set.mutate(b64, { onSuccess: () => toast.success("Foto profil diganti"), onError: (e) => setError(businessErrorText(e)) });
    } catch {
      setError("Gambar tidak bisa dibaca. Coba berkas lain.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {profile.picture_url ? <img src={profile.picture_url} alt="Foto profil" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <User className="h-10 w-10 text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Foto profil</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Pilih foto profil" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" size="sm" variant="outline" disabled={set.isPending} onClick={() => input.current?.click()}>
              {set.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}Ganti foto
            </Button>
            {profile.picture_url && (
              <Button type="button" size="sm" variant="ghost" disabled={set.isPending} onClick={() => set.mutate(null, { onSuccess: () => toast.success("Foto profil dihapus"), onError: (e) => setError(businessErrorText(e)) })}>
                <Trash2 className="mr-1.5 h-4 w-4" />Hapus
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Gambar dipotong persegi dan dikecilkan otomatis. Foto ini terlihat oleh kontak Anda sesuai pengaturan privasi WhatsApp.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function BasicForm({ deviceKey, profile, canEdit }: { deviceKey: string; profile: DeviceProfile; canEdit: boolean }) {
  const update = useUpdateProfile(deviceKey);
  const [name, setName] = useState(profile.name ?? "");
  const [about, setAbout] = useState(profile.about ?? "");
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== (profile.name ?? "") || about.trim() !== (profile.about ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate({
      ...(name.trim() !== (profile.name ?? "") && name.trim() ? { name: name.trim() } : {}),
      ...(about.trim() !== (profile.about ?? "") ? { about: about.trim() } : {}),
    }, { onSuccess: () => toast.success("Profil disimpan"), onError: (err) => setError(businessErrorText(err)) });
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pf-name">Nama tampilan</Label>
        <Input id="pf-name" value={name} maxLength={25} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        <p className="text-xs text-muted-foreground">Maksimal 25 karakter. Ini nama yang dilihat kontak yang belum menyimpan nomor Anda.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pf-about">Info</Label>
        <Textarea id="pf-about" value={about} maxLength={139} rows={2} onChange={(e) => setAbout(e.target.value)} disabled={!canEdit} />
        <p className="text-xs text-muted-foreground">{about.length}/139</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canEdit && <Button type="submit" disabled={!changed || update.isPending}>{update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>}
    </form>
  );
}

function BusinessForm({ deviceKey, profile, canEdit }: { deviceKey: string; profile: DeviceProfile; canEdit: boolean }) {
  const update = useUpdateProfile(deviceKey);
  const b = profile.business ?? {};
  const [description, setDescription] = useState(b.description ?? "");
  const [address, setAddress] = useState(b.address ?? "");
  const [email, setEmail] = useState(b.email ?? "");
  const [website, setWebsite] = useState((b.website ?? [])[0] ?? "");
  const [hours, setHours] = useState<Record<string, Row>>(() => Object.fromEntries(DAYS.map((d) => [d.id, { mode: "closed", open: "09:00", close: "17:00" } as Row])));
  const [hoursOn, setHoursOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const days: BusinessHoursDay[] = DAYS.flatMap((d) => {
      const r = hours[d.id]!;
      if (r.mode === "closed") return [];
      return [r.mode === "specific_hours" ? { day: d.id, mode: r.mode, open: r.open, close: r.close } : { day: d.id, mode: r.mode }];
    });
    update.mutate({
      business: {
        description: description.trim(), address: address.trim(),
        ...(email.trim() ? { email: email.trim() } : {}), ...(website.trim() ? { websites: [website.trim()] } : {}),
        ...(hoursOn && days.length ? { hours: { timezone: "Asia/Jakarta", days } } : {}),
      },
    }, { onSuccess: () => toast.success("Profil bisnis disimpan"), onError: (err) => setError(businessErrorText(err)) });
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div className="space-y-2"><Label htmlFor="b-desc">Deskripsi bisnis</Label><Textarea id="b-desc" value={description} maxLength={512} rows={3} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} /></div>
      <div className="space-y-2"><Label htmlFor="b-addr">Alamat</Label><Input id="b-addr" value={address} maxLength={256} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="b-mail">Email</Label><Input id="b-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canEdit} /></div>
        <div className="space-y-2"><Label htmlFor="b-web">Situs web</Label><Input id="b-web" inputMode="url" value={website} onChange={(e) => setWebsite(e.target.value)} disabled={!canEdit} /></div>
      </div>
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Jam buka</legend>
        <label className="flex items-center gap-2 text-sm"><Switch checked={hoursOn} onCheckedChange={setHoursOn} disabled={!canEdit} />Ubah jam buka (biarkan mati bila tidak ingin mengubah)</label>
        {hoursOn && DAYS.map((d) => {
          const r = hours[d.id]!;
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-sm">{d.label}</span>
              <Select value={r.mode} onValueChange={(v) => setHours({ ...hours, [d.id]: { ...r, mode: v as Row["mode"] } })}>
                <SelectTrigger className="w-44" aria-label={`Jam buka ${d.label}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed">Tutup</SelectItem><SelectItem value="open_24h">Buka 24 jam</SelectItem>
                  <SelectItem value="appointment_only">Hanya dengan janji</SelectItem><SelectItem value="specific_hours">Jam tertentu</SelectItem>
                </SelectContent>
              </Select>
              {r.mode === "specific_hours" && (<>
                <Input type="time" aria-label={`Buka ${d.label}`} value={r.open} onChange={(e) => setHours({ ...hours, [d.id]: { ...r, open: e.target.value } })} className="w-28" />
                <span className="text-sm text-muted-foreground">sampai</span>
                <Input type="time" aria-label={`Tutup ${d.label}`} value={r.close} onChange={(e) => setHours({ ...hours, [d.id]: { ...r, close: e.target.value } })} className="w-28" />
              </>)}
            </div>
          );
        })}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canEdit && <Button type="submit" disabled={update.isPending}>{update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan profil bisnis</Button>}
    </form>
  );
}

/** Profile of one device: photo, display name and About for any number; business details when it is WhatsApp Business. */
export function DeviceProfileTab({ deviceKey, online, canEdit }: { deviceKey: string; online: boolean; canEdit: boolean }) {
  const profile = useProfile(online ? deviceKey : undefined);
  if (!online) return <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Device harus online untuk melihat dan mengubah profilnya. Sambungkan dulu lewat QR.</p>;
  if (profile.isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-24 rounded-full" /><Skeleton className="h-10 max-w-xl" /><p className="text-sm text-muted-foreground">Menanyakan ke device, bisa sampai setengah menit…</p></div>;
  if (profile.isError || !profile.data) return <p role="alert" className="text-sm text-destructive">{businessErrorText(profile.error)}</p>;
  const data = profile.data;
  return (
    <div className="space-y-8">
      <Photo deviceKey={deviceKey} profile={data} canEdit={canEdit} />
      <BasicForm key={`${data.name}|${data.about}`} deviceKey={deviceKey} profile={data} canEdit={canEdit} />
      {data.is_business && (
        <section className="space-y-3 border-t pt-6">
          <h3 className="text-lg font-semibold">Profil bisnis</h3>
          <BusinessForm key={JSON.stringify(data.business)} deviceKey={deviceKey} profile={data} canEdit={canEdit} />
        </section>
      )}
    </div>
  );
}
