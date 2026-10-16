"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  apiErrorMessage,
  useContacts,
  useCreateContact,
  useDeleteContact,
  useImportContacts,
  useContactGroups,
} from "@/hooks/use-contacts";
import { api } from "@/lib/api";
import {
  clearLegacyContacts,
  getLegacyContacts,
  legacyContactsToCsv,
  type LegacyContact,
} from "@/lib/contacts";
import { formatPhoneNumber } from "@/lib/utils";

const PAGE_SIZE = 20;

export default function ContactsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [legacy, setLegacy] = useState<LegacyContact[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isPlaceholderData } = useContacts({
    search: search || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const deleteContact = useDeleteContact();
  const importContacts = useImportContacts();
  const groups = useContactGroups();
  const groupMembers = useQuery({
    queryKey: ["contact-group-members", selectedGroupId],
    queryFn: () => api.getContactGroupMembers(selectedGroupId),
    enabled: Boolean(selectedGroupId),
  });

  // Debounce search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    // localStorage is only readable on the client; a one-time read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLegacy(getLegacyContacts());
  }, []);

  const total = data?.pagination.total ?? 0;
  const contacts = data?.data ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const migrateLegacy = () =>
    importContacts.mutate(legacyContactsToCsv(legacy), {
      onSuccess: () => {
        clearLegacyContacts();
        setLegacy([]);
      },
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-heading">Kontak</h2>
          <p className="text-muted-foreground">Daftar pelanggan Anda, sekaligus daftar penerima untuk Broadcast.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importContacts.mutate(await file.text());
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importContacts.isPending}
          >
            <Upload className="mr-2 h-4 w-4" />
            Impor CSV
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah kontak
          </Button>
        </div>
      </div>

      {legacy.length > 0 && (
        <div className="surface flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Ditemukan <strong>{legacy.length}</strong> kontak yang hanya tersimpan di
            browser ini. Pindahkan ke akun Anda supaya tersinkron dan bisa dipakai di Broadcast.
          </p>
          <Button size="sm" onClick={migrateLegacy} disabled={importContacts.isPending}>
            Pindahkan ke akun
          </Button>
        </div>
      )}

      <div className="sticky top-16 z-20 bg-background py-2">
        <div className="relative">
        <Search className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Cari nama atau nomor…"
          className="h-11 pl-12"
          aria-label="Cari kontak"
        />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Grup kontak</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Buat grup dan tambahkan kontak yang sedang terlihat pada halaman ini. Campaign hanya menyertakan kontak dengan consent opt-in.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Nama grup baru" placeholder="Nama grup baru" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={100} />
            <Button disabled={!groupName.trim() || groups.createGroup.isPending} onClick={() => groups.createGroup.mutate(groupName.trim(), { onSuccess: (group) => { setSelectedGroupId(group.id); setGroupName(""); } })}>Buat grup</Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select aria-label="Pilih grup kontak" className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
              <option value="">Pilih grup</option>
              {(groups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name} ({group.member_count})</option>)}
            </select>
            <Button variant="outline" disabled={!selectedGroupId || !contacts.length || groups.saveMembers.isPending || groupMembers.isLoading} onClick={() => {
              const ids = new Set((groupMembers.data ?? []).map((member) => member.id));
              for (const contact of contacts) ids.add(contact.id);
              groups.saveMembers.mutate({ id: selectedGroupId, contact_ids: [...ids] });
            }}>Tambahkan {contacts.length} kontak halaman ini</Button>
            <Button variant="outline" disabled={!selectedGroupId || !contacts.length || groups.saveMembers.isPending || groupMembers.isLoading} onClick={() => {
              const visibleIds = new Set(contacts.map((contact) => contact.id));
              const ids = (groupMembers.data ?? []).map((member) => member.id).filter((id) => !visibleIds.has(id));
              groups.saveMembers.mutate({ id: selectedGroupId, contact_ids: ids });
            }}>Keluarkan kontak halaman ini</Button>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-label">Nama</TableHead>
              <TableHead className="text-label">Telepon</TableHead>
              <TableHead className="text-label hidden sm:table-cell">Label</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {search ? "Tidak ada kontak yang cocok" : "Belum ada kontak"}
                    </p>
                    {!search && (
                      <p className="text-xs text-muted-foreground">
                        Header CSV: <code>phone_number,name,tags,notes</code> (label dipisah dengan <code>|</code>)
                      </p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow key={contact.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ContactAvatar name={contact.name} phone={contact.phone_number} />
                      <span className="font-medium">{contact.name || "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatPhoneNumber(contact.phone_number)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      {contact.tags.map((tag) => (
                        <span key={tag} className="rounded-lg border px-1.5 py-0.5 text-xs text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={deleteContact.isPending}
                      onClick={() => {
                        if (window.confirm(`Hapus ${contact.name || contact.phone_number}?`)) {
                          deleteContact.mutate(contact.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Hapus</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Halaman {page} dari {totalPages} · {total} kontak
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPlaceholderData || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Berikutnya
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AddContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createContact = useCreateContact();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");

  const normalizedPhone = useMemo(() => phone.replace(/[\s-]/g, ""), [phone]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createContact.mutate(
      {
        phone_number: normalizedPhone,
        name: name.trim() || undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          setPhone("");
          setName("");
          setTags("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) createContact.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah kontak</DialogTitle>
          <DialogDescription>Nomor dalam format internasional, mis. +6281234567890.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-phone">Nomor telepon</Label>
            <Input
              id="contact-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+6281234567890"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-name">Nama (opsional)</Label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-tags">Label (opsional, pisahkan dengan koma)</Label>
            <Input id="contact-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, jakarta" />
          </div>
          {createContact.isError && (
            <p className="text-sm text-destructive">
              {isDuplicate(createContact.error)
                ? "Nomor ini sudah ada di kontak Anda."
                : apiErrorMessage(createContact.error, "Gagal menambah kontak.")}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={createContact.isPending || !normalizedPhone}>
            {createContact.isPending ? "Menyimpan..." : "Simpan kontak"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function isDuplicate(error: unknown): boolean {
  const status = (error as { response?: { status?: number } }).response?.status;
  return status === 409;
}
