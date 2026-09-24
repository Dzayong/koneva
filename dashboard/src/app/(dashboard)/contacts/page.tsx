"use client";

import { useRef } from "react";
import { Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useContacts } from "@/hooks/use-contacts";
import { parseContactsCsv } from "@/lib/contacts";
import { formatPhoneNumber } from "@/lib/utils";

export default function ContactsPage() {
  const { contacts, importContacts, remove } = useContacts();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { rows, skipped } = parseContactsCsv(text);

    if (rows.length === 0) {
      toast.error("No contacts imported", {
        description: 'CSV needs a "phone" column header (and optionally "name").',
      });
      return;
    }

    importContacts(rows);
    toast.success(`Imported ${rows.length} contact${rows.length === 1 ? "" : "s"}`, {
      description: skipped > 0 ? `${skipped} row(s) skipped (missing/invalid phone)` : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">
            Stored in this browser only — used as a recipient list for Broadcast.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">No contacts yet</p>
                    <p className="text-xs text-muted-foreground">
                      CSV format: <code>name,phone</code>
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell>{formatPhoneNumber(contact.phone)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(contact.id)}>
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {contacts.length > 0 && (
        <Badge variant="outline">{contacts.length} contact{contacts.length === 1 ? "" : "s"}</Badge>
      )}
    </div>
  );
}
