"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@/hooks/use-contacts";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isPlaceholderData } = useContacts({
    search: search || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const deleteContact = useDeleteContact();
  const importContacts = useImportContacts();

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
          <h2 className="text-heading">Contacts</h2>
          <p className="text-muted-foreground">Your customer list — also the recipient list for Broadcast.</p>
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
            Import CSV
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Contact
          </Button>
        </div>
      </div>

      {legacy.length > 0 && (
        <div className="surface flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Found <strong>{legacy.length}</strong> contact{legacy.length === 1 ? "" : "s"} saved only in
            this browser. Move them to your account so they sync and work in Broadcast.
          </p>
          <Button size="sm" onClick={migrateLegacy} disabled={importContacts.isPending}>
            Move to account
          </Button>
        </div>
      )}

      <div className="sticky top-16 z-20 bg-background py-2">
        <div className="relative">
        <Search className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name or number…"
          className="h-11 pl-12"
          aria-label="Search contacts"
        />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-label">Name</TableHead>
              <TableHead className="text-label">Phone</TableHead>
              <TableHead className="text-label hidden sm:table-cell">Tags</TableHead>
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
                      {search ? "No contacts match your search" : "No contacts yet"}
                    </p>
                    {!search && (
                      <p className="text-xs text-muted-foreground">
                        CSV header: <code>phone_number,name,tags,notes</code> (tags separated by <code>|</code>)
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
                        if (window.confirm(`Delete ${contact.name || contact.phone_number}?`)) {
                          deleteContact.mutate(contact.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
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
          Page {page} of {totalPages} · {total} contact{total === 1 ? "" : "s"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPlaceholderData || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
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
          <DialogTitle>Add Contact</DialogTitle>
          <DialogDescription>Numbers in international format, e.g. +6281234567890.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone number</Label>
            <Input
              id="contact-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+6281234567890"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name (optional)</Label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-tags">Tags (optional, comma separated)</Label>
            <Input id="contact-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, jakarta" />
          </div>
          {createContact.isError && (
            <p className="text-sm text-destructive">
              {isDuplicate(createContact.error)
                ? "This number is already in your contacts."
                : apiErrorMessage(createContact.error, "Failed to add contact.")}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={createContact.isPending || !normalizedPhone}>
            {createContact.isPending ? "Saving..." : "Save Contact"}
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
