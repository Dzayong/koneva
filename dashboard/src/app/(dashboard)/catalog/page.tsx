"use client";

import { useMemo, useState } from "react";
import { EyeOff, Loader2, Pencil, Plus, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DeviceSelect } from "@/components/devices/device-select";
import { useDevices } from "@/hooks/use-devices";
import { useBusiness, useCatalog, useDeleteProduct, useSaveProduct, useUpdateBusiness } from "@/hooks/use-business";
import { usePermissions } from "@/hooks/use-me";
import { businessErrorText } from "@/lib/business-errors";
import type { BusinessHoursDay, BusinessProfile, CatalogProduct, ProductInput } from "@/lib/types";
import { cn } from "@/lib/utils";

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const DAYS: Array<{ id: BusinessHoursDay["day"]; label: string }> = [
  { id: "mon", label: "Senin" }, { id: "tue", label: "Selasa" }, { id: "wed", label: "Rabu" }, { id: "thu", label: "Kamis" },
  { id: "fri", label: "Jumat" }, { id: "sat", label: "Sabtu" }, { id: "sun", label: "Minggu" },
];

function ProductDialog({ deviceKey, product, open, onClose }: { deviceKey: string; product: CatalogProduct | null; open: boolean; onClose: () => void }) {
  const save = useSaveProduct(deviceKey);
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [images, setImages] = useState(Object.values(product?.imageUrls ?? {}).slice(0, 1).join("\n"));
  const [url, setUrl] = useState(product?.url ?? "");
  const [hidden, setHidden] = useState(product?.isHidden ?? false);
  const [error, setError] = useState<string | null>(null);
  const urls = images.split(/\s+/).filter(Boolean);
  const valid = name.trim() && Number(price) >= 0 && price !== "" && urls.length > 0 && urls.every((u) => /^https:\/\//i.test(u));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: ProductInput = { name: name.trim(), description: description.trim(), price: Number(price), currency: "IDR", is_hidden: hidden, image_urls: urls, ...(url.trim() ? { url: url.trim() } : {}) };
    save.mutate({ ...(product ? { id: product.id } : {}), body }, {
      onSuccess: () => { toast.success(product ? "Produk diperbarui" : "Produk ditambahkan"); onClose(); },
      onError: (err) => setError(businessErrorText(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{product ? "Ubah produk" : "Tambah produk"}</DialogTitle>
            <DialogDescription>Produk langsung tampil di katalog WhatsApp Business nomor ini.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2"><Label htmlFor="p-name">Nama produk</Label><Input id="p-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="p-price">Harga (Rp)</Label><Input id="p-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="25000" /></div>
          <div className="space-y-2"><Label htmlFor="p-desc">Deskripsi</Label><Textarea id="p-desc" value={description} maxLength={1024} rows={3} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="space-y-2">
            <Label htmlFor="p-img">Alamat gambar (https)</Label>
            <Textarea id="p-img" value={images} rows={2} onChange={(e) => setImages(e.target.value)} placeholder="https://situs-anda.com/kaos.jpg" />
            <p className="text-xs text-muted-foreground">Satu alamat per baris, maksimal 10. Berkas harus bisa dibuka publik.</p>
          </div>
          <div className="space-y-2"><Label htmlFor="p-url">Tautan produk (opsional)</Label><Input id="p-url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <div className="flex items-center justify-between"><Label htmlFor="p-hide">Sembunyikan dari katalog</Label><Switch id="p-hide" checked={hidden} onCheckedChange={setHidden} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={!valid || save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Products({ deviceKey, canEdit }: { deviceKey: string; canEdit: boolean }) {
  const catalog = useCatalog(deviceKey, true);
  const del = useDeleteProduct(deviceKey);
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  if (catalog.isLoading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>;
  if (catalog.isError) return <p role="alert" className="text-sm text-destructive">{businessErrorText(catalog.error)}</p>;
  const products = catalog.data?.products ?? [];

  return (
    <div className="space-y-4">
      {canEdit && <Button onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" />Tambah produk</Button>}
      <p className="text-xs text-muted-foreground">Harga dikirim sebagai rupiah penuh. Setelah produk pertama dibuat, cek harganya di aplikasi WhatsApp Business untuk memastikan tampil benar.</p>
      {products.length === 0 ? <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Katalog masih kosong.</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const img = Object.values(p.imageUrls ?? {})[0];
            return (
              <li key={p.id} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img ? <img src={img} alt={p.name} loading="lazy" className="h-full w-full object-cover" /> : <Store className="h-8 w-8 text-muted-foreground" />}
                </div>
                <div className="space-y-1 p-4">
                  <div className="flex items-start justify-between gap-2"><p className="font-medium">{p.name}</p>{p.isHidden && <Badge variant="secondary" className="shrink-0"><EyeOff className="mr-1 h-3 w-3" />Tersembunyi</Badge>}</div>
                  <p className="text-sm font-semibold">{rupiah(p.price)}</p>
                  {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                  {canEdit && (
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="mr-1 h-3.5 w-3.5" />Ubah</Button>
                      {confirm === p.id
                        ? <Button size="sm" variant="destructive" disabled={del.isPending} onClick={() => del.mutate(p.id, { onSuccess: () => { setConfirm(null); toast.success("Produk dihapus"); }, onError: (e) => toast.error(businessErrorText(e)) })}>Ya, hapus</Button>
                        : <Button size="sm" variant="ghost" onClick={() => setConfirm(p.id)}><Trash2 className="mr-1 h-3.5 w-3.5" />Hapus</Button>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && <ProductDialog key="new" deviceKey={deviceKey} product={null} open onClose={() => setAdding(false)} />}
      {editing && <ProductDialog key={editing.id} deviceKey={deviceKey} product={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}

type Row = { mode: "closed" | BusinessHoursDay["mode"]; open: string; close: string };

function ProfileForm({ deviceKey, profile, canEdit }: { deviceKey: string; profile: BusinessProfile; canEdit: boolean }) {
  const update = useUpdateBusiness(deviceKey);
  const [description, setDescription] = useState(profile.description ?? "");
  const [address, setAddress] = useState(profile.address ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [website, setWebsite] = useState((profile.website ?? [])[0] ?? "");
  const [hours, setHours] = useState<Record<string, Row>>(() => Object.fromEntries(DAYS.map((d) => [d.id, { mode: "closed", open: "09:00", close: "17:00" } as Row])));
  const [setHoursOn, setSetHoursOn] = useState(false);
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
      description: description.trim(), address: address.trim(),
      ...(email.trim() ? { email: email.trim() } : {}), ...(website.trim() ? { websites: [website.trim()] } : {}),
      ...(setHoursOn && days.length ? { hours: { timezone: "Asia/Jakarta", days } } : {}),
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
        <label className="flex items-center gap-2 text-sm"><Switch checked={setHoursOn} onCheckedChange={setSetHoursOn} disabled={!canEdit} />Ubah jam buka (kosongkan bila tidak ingin mengubah)</label>
        {setHoursOn && DAYS.map((d) => {
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
      {canEdit && <Button type="submit" disabled={update.isPending}>{update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan profil</Button>}
    </form>
  );
}

export default function CatalogPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data: devices, isLoading } = useDevices();
  const [chosen, setChosen] = useState<string>();
  const [tab, setTab] = useState<"produk" | "profil">("produk");
  const online = useMemo(() => (devices ?? []).filter((d) => d.status === "online"), [devices]);
  const deviceKey = chosen ?? online[0]?.device_key;
  const business = useBusiness(deviceKey);

  if (!permsLoading && !can("devices:read")) return <p className="text-muted-foreground">Peran Anda tidak bisa membuka halaman ini.</p>;
  const canEdit = can("content:write");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-display">Katalog dan profil bisnis</h1>
        <p className="mt-2 text-muted-foreground">Kelola katalog produk dan profil untuk nomor yang terdaftar di WhatsApp Business.</p>
      </div>
      {isLoading ? <Skeleton className="h-40" /> : online.length === 0 ? (
        <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Belum ada nomor yang online. Sambungkan nomor dulu di menu Nomor.</p>
      ) : (
        <>
          <DeviceSelect devices={devices ?? []} value={deviceKey} onChange={setChosen} />
          {business.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Menanyakan ke nomor, bisa sampai setengah menit…</p>
          ) : business.isError ? (
            <p role="alert" className="text-sm text-destructive">{businessErrorText(business.error)}</p>
          ) : !business.data?.is_business ? (
            <div className="rounded-xl border bg-card p-6">
              <Store className="h-6 w-6 text-muted-foreground" />
              <h2 className="mt-3 text-lg font-semibold">Nomor ini WhatsApp biasa</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Katalog dan profil bisnis hanya ada di aplikasi WhatsApp Business. Anda bisa mengubah nomor ini ke akun bisnis lewat aplikasi WhatsApp Business di HP, lalu kembali ke sini.</p>
            </div>
          ) : (
            <>
              <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <strong>Eksperimental.</strong> Profil bisnis sudah teruji berjalan. Katalog produk bergantung pada jawaban WhatsApp untuk sesi perangkat tertaut, dan pada satu nomor uji WhatsApp tidak menjawab permintaan katalog. Bila gagal, kami tampilkan alasannya, bukan katalog kosong palsu.
              </p>
              <div role="tablist" aria-label="Bagian" className="inline-flex rounded-lg border bg-muted p-1">
                {([["produk", "Produk"], ["profil", "Profil bisnis"]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("rounded-md px-4 py-1.5 text-sm font-medium", tab === id ? "bg-background shadow-sm" : "text-muted-foreground")}>{label}</button>
                ))}
              </div>
              {deviceKey && (tab === "produk"
                ? <Products key={deviceKey} deviceKey={deviceKey} canEdit={canEdit} />
                : <ProfileForm key={deviceKey} deviceKey={deviceKey} profile={business.data.profile ?? {}} canEdit={canEdit} />)}
            </>
          )}
        </>
      )}
    </div>
  );
}
