"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { useChangeRole, useInviteMember, useRemoveMember, useRevokeInvitation, useTeam } from "@/hooks/use-developer";
import { usePermissions } from "@/hooks/use-me";
import { apiFailure } from "@/lib/errors";
import type { CreatedInvitation, Role, TeamMember } from "@/lib/types";
import { formatDate, formatRelativeTime } from "@/lib/utils";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", developer: "Developer", viewer: "Viewer" };
const ROLE_HELP: Record<Role, string> = {
  owner: "Semua akses, termasuk tagihan dan tim.",
  admin: "Semua akses kecuali tagihan. Mengelola developer dan viewer.",
  developer: "Menyambungkan nomor, mengirim pesan, mengelola kunci API dan webhook. Tidak bisa menghapus nomor atau mengelola tim.",
  viewer: "Hanya melihat nomor dan pesan. Tidak bisa melihat QR.",
};

/** Mirrors the server: owners grant any role, admins only developer and viewer. */
const grantable = (actor: Role | undefined): Role[] => (actor === "owner" ? ["owner", "admin", "developer", "viewer"] : actor === "admin" ? ["developer", "viewer"] : []);
const canManage = (actor: Role | undefined, target: Role): boolean => actor === "owner" || (actor === "admin" && (target === "developer" || target === "viewer"));

export default function TeamPage() {
  const { can, role, user, isLoading: permsLoading } = usePermissions();
  const { data, isLoading } = useTeam();
  const invite = useInviteMember();
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const revokeInvite = useRevokeInvitation();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("developer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [link, setLink] = useState<CreatedInvitation | null>(null);
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);

  if (!permsLoading && !can("team:manage")) {
    return <p className="text-muted-foreground">Peran Anda tidak bisa mengelola tim.</p>;
  }

  const roles = grantable(role).filter((r) => r !== "owner");

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    invite.mutate({ email: email.trim(), role: inviteRole }, {
      onSuccess: (created) => { setLink(created); setInviteOpen(false); setEmail(""); },
      onError: (err) => {
        const f = apiFailure(err);
        setInviteError(f.code === "ALREADY_MEMBER" ? "Orang ini sudah ada di workspace." : f.message);
      },
    });
  };

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-display">Tim</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Undang rekan kerja dan atur apa yang boleh mereka lakukan. Setiap orang masuk dengan akunnya sendiri, jadi semua tindakan tercatat atas nama mereka.</p>
        </div>
        <Button onClick={() => { setInviteRole(roles[roles.length - 2] ?? "developer"); setInviteOpen(true); }}><UserPlus className="mr-2 h-4 w-4" />Undang</Button>
      </div>

      <section aria-labelledby="anggota">
        <h3 id="anggota" className="text-heading mb-3 text-lg">Anggota</h3>
        {isLoading ? <Skeleton className="h-32 w-full" /> : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Peran</TableHead><TableHead>Bergabung</TableHead><TableHead>Terakhir masuk</TableHead><TableHead className="w-10"><span className="sr-only">Aksi</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.members ?? []).map((m) => {
                  const self = m.user_id === user?.id;
                  const editable = !self && canManage(role, m.role);
                  return (
                    <TableRow key={m.user_id}>
                      <TableCell><p className="font-medium">{m.name}{self && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Anda</span>}</p><p className="text-sm text-muted-foreground">{m.email}</p></TableCell>
                      <TableCell>
                        {editable ? (
                          <Select value={m.role} onValueChange={(r) => changeRole.mutate({ userId: m.user_id, role: r as Role })}>
                            <SelectTrigger className="w-36" aria-label={`Peran ${m.name}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{grantable(role).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <span className="text-sm">{ROLE_LABEL[m.role]}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(m.joined_at)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{m.last_login_at ? formatRelativeTime(m.last_login_at) : "Belum pernah"}</TableCell>
                      <TableCell>{editable && <Button variant="ghost" size="icon" aria-label={`Keluarkan ${m.name}`} onClick={() => setToRemove(m)}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {(data?.invitations.length ?? 0) > 0 && (
        <section aria-labelledby="undangan">
          <h3 id="undangan" className="text-heading mb-1 text-lg">Undangan menunggu</h3>
          <p className="mb-3 text-sm text-muted-foreground">Tautan hanya tampil saat dibuat. Jika hilang, undang ulang; tautan lama otomatis tidak berlaku.</p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Peran</TableHead><TableHead>Berlaku</TableHead><TableHead className="w-10"><span className="sr-only">Aksi</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {data!.invitations.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>{ROLE_LABEL[i.role]}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">berlaku sampai {formatDate(i.expires_at)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => revokeInvite.mutate(i.id)}>Batalkan</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section aria-labelledby="peran" className="rounded-lg border bg-card p-5">
        <h3 id="peran" className="text-heading mb-3 text-lg">Apa yang boleh dilakukan tiap peran</h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <div key={r}><dt className="font-medium">{ROLE_LABEL[r]}</dt><dd className="text-sm text-muted-foreground">{ROLE_HELP[r]}</dd></div>
          ))}
        </dl>
      </section>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undang rekan kerja</DialogTitle>
            <DialogDescription>Anda akan mendapat tautan untuk dikirim sendiri. Tautan berlaku 48 jam, sekali pakai, dan hanya untuk email ini.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="inv-email">Email</Label><Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></div>
            <div className="space-y-2">
              <Label htmlFor="inv-role">Peran</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger id="inv-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[inviteRole]}</p>
            </div>
            {inviteError && <p role="alert" className="text-sm text-destructive">{inviteError}</p>}
            <DialogFooter><Button type="submit" disabled={invite.isPending || !email}>{invite.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Membuat…</> : <><Plus className="mr-2 h-4 w-4" />Buat tautan undangan</>}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {link && (
        <SecretReveal
          open
          title="Tautan undangan siap"
          description={`Kirim tautan ini ke ${link.email} sebagai ${ROLE_LABEL[link.role]}.`}
          secret={`${window.location.origin}${link.accept_path}`}
          warning="Tautan hanya ditampilkan sekali. Berlaku 48 jam, sekali pakai, dan hanya bisa diterima oleh email tersebut."
          doneLabel="Sudah saya kirim"
          onDone={() => setLink(null)}
        />
      )}

      <Dialog open={toRemove !== null} onOpenChange={(o) => !o && setToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keluarkan {toRemove?.name}?</DialogTitle>
            <DialogDescription>Akses ke workspace ini langsung dicabut. Akunnya tetap ada, dan riwayat tindakannya tetap tercatat.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToRemove(null)}>Batal</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => toRemove && remove.mutate(toRemove.user_id, { onSuccess: () => setToRemove(null) })}>Keluarkan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
