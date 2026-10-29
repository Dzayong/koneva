"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmailVerificationDialog } from "@/components/account/email-verification-dialog";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { useSetMemberDevices, useChangeRole, useInviteMember, useIssueLegacyRoleNotice, useRemoveMember, useRevokeInvitation, useTeam } from "@/hooks/use-developer";
import { usePermissions } from "@/hooks/use-me";
import { apiFailure } from "@/lib/errors";
import { ROLE_HELP, ROLE_LABEL, canManageTeam, isLegacyRole } from "@/lib/roles";
import type { CreatedInvitation, Role, TeamMember } from "@/lib/types";
import { formatDate, formatRelativeTime } from "@/lib/utils";

/** Removal mirrors the server: the owner removes anyone else; a legacy admin may still remove developers and viewers. */
const canRemove = (actor: Role | undefined, target: Role): boolean => actor === "owner" || (actor === "admin" && (target === "developer" || target === "viewer"));
const GMAIL = /^[^@\s]+@gmail\.com$/i;

export default function TeamPage() {
  const { can, role, user, isLoading: permsLoading } = usePermissions();
  const { data, isLoading } = useTeam();
  const invite = useInviteMember();
  const setDevices = useSetMemberDevices();
  const [inviteDevices, setInviteDevices] = useState<string[]>([]);
  const [editingCs, setEditingCs] = useState<TeamMember | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const revokeInvite = useRevokeInvitation();
  const issueLegacyNotice = useIssueLegacyRoleNotice();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteRole, setInviteRole] = useState<"developer" | "cs">("developer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [link, setLink] = useState<CreatedInvitation | null>(null);
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  if (!permsLoading && !can("team:manage")) {
    return <p className="text-muted-foreground">Peran Anda tidak bisa mengelola tim.</p>;
  }

  const isOwner = canManageTeam(role);
  const hasLegacy = (data?.members ?? []).some((m) => isLegacyRole(m.role));
  const legacyTransition = data?.legacy_role_transition;

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    if (inviteRole === "cs") {
      if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setInviteError("Masukkan alamat email yang valid untuk akun CS."); return; }
      if (!phone.trim()) { setInviteError("Nomor WhatsApp CS wajib diisi untuk verifikasi OTP."); return; }
    } else {
      if (!GMAIL.test(email.trim())) { setInviteError("Undangan hanya untuk alamat Gmail (@gmail.com): alamat yang akan dipakai penerima di KONEVA."); return; }
    }
    invite.mutate({ email: email.trim(), role: inviteRole, device_keys: inviteRole === "cs" ? inviteDevices : [], phone: inviteRole === "cs" ? phone.trim() : undefined }, {
      onSuccess: (created) => { setLink(created); setInviteOpen(false); setEmail(""); setPhone(""); setInviteRole("developer"); setInviteDevices([]); },
      onError: (err) => {
        const f = apiFailure(err);
        if (f.code === "EMAIL_NOT_VERIFIED") { setInviteError("Verifikasi email Anda dulu sebelum mengundang anggota."); setVerifyOpen(true); return; }
        setInviteError(f.code === "ALREADY_MEMBER" ? "Orang ini sudah ada di workspace." : f.code === "GMAIL_REQUIRED" ? "Undangan hanya untuk alamat Gmail (@gmail.com)." : f.message);
      },
    });
  };

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-display">Tim</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Undang Developer untuk integrasi teknis atau Customer Service untuk membaca dan membalas percakapan. Setiap orang masuk dengan akunnya sendiri.</p>
        </div>
        {isOwner && <Button onClick={() => setInviteOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Undang anggota</Button>}
      </div>

      {isOwner && (legacyTransition?.legacy_member_count ?? 0) > 0 && (
        <section aria-labelledby="legacy-role-transition" className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
          <h3 id="legacy-role-transition" className="text-heading text-lg">Transisi peran Admin/Viewer lama</h3>
          {legacyTransition!.phase === "notice_required" ? (
            <>
              <p className="text-sm text-muted-foreground">Workspace ini masih memiliki {legacyTransition!.legacy_member_count} anggota dengan peran lama. Hak akses mereka tetap sama sampai Anda menerbitkan pemberitahuan resmi. Setelah diterbitkan, masa transisi 60 hari dimulai; peran tidak akan dinaikkan otomatis.</p>
              <Button variant="outline" onClick={() => setNoticeOpen(true)}>Tinjau dan terbitkan pemberitahuan 60 hari</Button>
            </>
          ) : legacyTransition!.phase === "suspended" ? (
            <p role="status" className="text-sm">Tenggat {formatDate(legacyTransition!.deadline_at!)} telah lewat. Akses workspace untuk anggota yang masih berperan Admin/Viewer lama ditangguhkan. Anda tetap dapat mengubahnya menjadi Developer bila sesuai, atau mengeluarkan anggota; tidak ada promosi atau penghapusan otomatis.</p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {legacyTransition!.phase === "reminder_due" ? `Pengingat: ` : ""}
              Masa transisi berjalan. Hak akses saat ini tetap berlaku sampai {formatDate(legacyTransition!.deadline_at!)} ({legacyTransition!.days_remaining} hari tersisa). Setelah tenggat, peran lama yang belum ditangani akan ditangguhkan tanpa promosi otomatis.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="anggota">
        <h3 id="anggota" className="text-heading mb-3 text-lg">Anggota</h3>
        {isLoading ? <Skeleton className="h-32 w-full" /> : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Peran</TableHead><TableHead>Bergabung</TableHead><TableHead>Terakhir masuk</TableHead><TableHead className="w-10"><span className="sr-only">Aksi</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.members ?? []).map((m) => {
                  const self = m.user_id === user?.id;
                  const editable = !self && canRemove(role, m.role);
                  return (
                    <TableRow key={m.user_id}>
                      <TableCell><p className="font-medium">{m.name}{self && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Anda</span>}</p><p className="text-sm text-muted-foreground">{m.email}</p></TableCell>
                      <TableCell>
                        <span className="text-sm">{ROLE_LABEL[m.role]}</span>
                        {isOwner && m.role === "cs" && <Button variant="link" size="sm" onClick={() => { setEditingCs(m); setSelectedDevices(m.device_keys ?? []); }}>Atur device ({m.device_keys?.length ?? 0})</Button>}
                        {isOwner && !self && isLegacyRole(m.role) && (
                          <Button variant="link" size="sm" className="ml-2 h-auto p-0 text-xs" disabled={changeRole.isPending}
                            onClick={() => changeRole.mutate({ userId: m.user_id, role: "developer" })}>Jadikan Developer</Button>
                        )}
                        {isOwner && !self && (m.role === "developer" || m.role === "cs") && (
                          <Button variant="link" size="sm" className="ml-2 h-auto p-0 text-xs" disabled={changeRole.isPending}
                            onClick={() => changeRole.mutate({ userId: m.user_id, role: m.role === "cs" ? "developer" : "cs" })}>
                            Jadikan {m.role === "cs" ? "Developer" : "Customer Service"}
                          </Button>
                        )}
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
                    <TableCell><span>{i.email}</span>{i.phone && <span className="block text-xs text-muted-foreground">WA: {i.phone}</span>}</TableCell>
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
          {((hasLegacy ? ["owner", "developer", "cs", "admin", "viewer"] : ["owner", "developer", "cs"]) as Role[]).map((r) => (
            <div key={r}><dt className="font-medium">{ROLE_LABEL[r]}</dt><dd className="text-sm text-muted-foreground">{ROLE_HELP[r]}</dd></div>
          ))}
        </dl>
      </section>

      <Dialog open={Boolean(editingCs)} onOpenChange={(open) => { if (!open && !setDevices.isPending) setEditingCs(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Akses device {editingCs?.name}</DialogTitle><DialogDescription>CS hanya bisa membaca dan membalas chat dari device yang dicentang.</DialogDescription></DialogHeader>
          <DeviceChoices devices={data?.devices ?? []} selected={selectedDevices} onChange={setSelectedDevices} />
          <DialogFooter><Button disabled={setDevices.isPending} onClick={() => editingCs && setDevices.mutate({ userId: editingCs.user_id, device_keys: selectedDevices }, { onSuccess: () => setEditingCs(null) })}>{setDevices.isPending ? "Menyimpan…" : "Simpan akses"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undang rekan kerja</DialogTitle>
            <DialogDescription>{inviteRole === "cs" ? "Anda akan mendapat tautan untuk dikirim sendiri. CS akan mengonfirmasi kode OTP yang dikirim ke WhatsApp-nya." : "Anda akan mendapat tautan untuk dikirim sendiri. Tautan berlaku 48 jam, sekali pakai, dan hanya bisa diterima oleh alamat Gmail ini setelah mengonfirmasi kode email."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-4">
            <div className="space-y-1">
              <div className="space-y-2"><Label htmlFor="inv-role">Peran</Label><select id="inv-role" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={inviteRole} onChange={(e) => { setInviteRole(e.target.value as "developer" | "cs"); setInviteError(null); }}><option value="developer">Developer</option><option value="cs">Customer Service</option></select><p className="text-xs text-muted-foreground">{ROLE_HELP[inviteRole]}</p></div>
            </div>
            <div className="space-y-2"><Label htmlFor="inv-email">{inviteRole === "cs" ? "Email penerima" : "Alamat Gmail penerima"}</Label><Input id="inv-email" type="email" required placeholder={inviteRole === "cs" ? "nama@email.com" : "nama@gmail.com"} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /><p className="text-xs text-muted-foreground">{inviteRole === "cs" ? "Email untuk login akun KONEVA (boleh email apa saja, tidak harus Gmail)." : "Pakai alamat Gmail yang akan dipakai penerima untuk akun KONEVA."}</p></div>
            {inviteRole === "cs" && <div className="space-y-2"><Label htmlFor="inv-phone">Nomor WhatsApp CS</Label><Input id="inv-phone" type="tel" required placeholder="08123456789" value={phone} onChange={(e) => setPhone(e.target.value)} /><p className="text-xs text-muted-foreground">Kode verifikasi OTP akan dikirim ke nomor WhatsApp ini.</p></div>}
            {inviteRole === "cs" && <DeviceChoices devices={data?.devices ?? []} selected={inviteDevices} onChange={setInviteDevices} />}
            {inviteError && <p role="alert" className="text-sm text-destructive">{inviteError}</p>}
            <DialogFooter><Button type="submit" disabled={invite.isPending || !email || (inviteRole === "cs" && !phone)}>{invite.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Membuat…</> : <><Plus className="mr-2 h-4 w-4" />Buat tautan undangan</>}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <EmailVerificationDialog open={verifyOpen} onOpenChange={setVerifyOpen} onVerified={() => setInviteError(null)} />

      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pemberitahuan transisi peran 60 hari</DialogTitle>
            <DialogDescription>
              Penerbitan ini memulai tenggat tepat 60 hari sejak sekarang. Selama masa itu akses Admin/Viewer lama tidak berubah. Sebelum tenggat, pilih satu tindakan untuk setiap anggota: ubah menjadi Developer bila akses teknisnya sesuai, atau keluarkan dari workspace. Setelah tenggat, anggota yang belum ditangani ditangguhkan dan tetap tercatat selama 90 hari tambahan. Sistem tidak pernah menaikkan peran secara otomatis.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoticeOpen(false)}>Kembali</Button>
            <Button disabled={issueLegacyNotice.isPending} onClick={() => issueLegacyNotice.mutate(undefined, { onSuccess: () => setNoticeOpen(false) })}>
              {issueLegacyNotice.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Menerbitkan…</> : "Terbitkan pemberitahuan resmi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {link && (
        <SecretReveal
          open
          title="Tautan undangan siap"
          description={link.role === "cs" ? `Kirim tautan ini ke ${link.email} sebagai ${ROLE_LABEL[link.role]}. Kode verifikasi akan dikirim via WhatsApp ke nomor yang sudah diisi.` : `Kirim tautan ini ke ${link.email} sebagai ${ROLE_LABEL[link.role]}. Penerima akan diminta memasukkan kode yang dikirim ke email tersebut.`}
          secret={`${window.location.origin}${link.accept_path}`}
          warning={link.role === "cs" ? "Tautan hanya ditampilkan sekali. Berlaku 48 jam, sekali pakai. Kode OTP dikirim lewat WhatsApp." : "Tautan hanya ditampilkan sekali. Berlaku 48 jam, sekali pakai, dan hanya bisa diterima oleh alamat Gmail tersebut setelah konfirmasi kode."}
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

function DeviceChoices({ devices, selected, onChange }: { devices: { device_key: string; label: string | null; phone_number: string | null }[]; selected: string[]; onChange: (keys: string[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">Device yang boleh diakses</legend>
    <p className="text-xs text-muted-foreground">Tanpa pilihan, CS belum bisa membuka chat. Owner bisa mengubah pilihan ini nanti.</p>
    <div className="max-h-60 space-y-2 overflow-y-auto">{devices.length === 0 && <p className="text-sm">Belum ada device di workspace ini.</p>}{devices.map((device) => <label key={device.device_key} className="flex items-center gap-3 rounded-md border p-3 text-sm"><input type="checkbox" checked={selected.includes(device.device_key)} onChange={(event) => onChange(event.target.checked ? [...selected, device.device_key] : selected.filter((key) => key !== device.device_key))} /><span>{device.label || device.device_key}<span className="block text-xs text-muted-foreground">{device.phone_number || device.device_key}</span></span></label>)}</div>
  </fieldset>;
}
