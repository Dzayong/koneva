"use client";

import { useState } from "react";
import { KeyRound, MoreHorizontal, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateKeyDialog, SCOPE_LABEL } from "@/components/developers/create-key-dialog";
import { SecretReveal } from "@/components/developers/secret-reveal";
import { useApiKeys, useRevokeApiKey, useRotateApiKey } from "@/hooks/use-developer";
import { usePermissions } from "@/hooks/use-me";
import type { ApiKeyRecord, CreatedApiKey } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function keyState(key: ApiKeyRecord): { label: string; tone: string } {
  if (key.revoked_at) return { label: "Dicabut", tone: "bg-gray-400" };
  if (key.expires_at && new Date(key.expires_at) <= new Date()) return { label: "Kedaluwarsa", tone: "bg-gray-400" };
  if (key.expires_at) return { label: `Berlaku sampai ${formatDate(key.expires_at)}`, tone: "bg-amber-500" };
  return { label: "Aktif", tone: "bg-green-600" };
}

export default function ApiKeysPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data, isLoading, isError } = useApiKeys();
  const rotate = useRotateApiKey();
  const revoke = useRevokeApiKey();
  const [createOpen, setCreateOpen] = useState(false);
  const [reveal, setReveal] = useState<{ key: CreatedApiKey; rotated: boolean } | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKeyRecord | null>(null);

  if (!permsLoading && !can("keys:manage")) {
    return <p className="text-muted-foreground">Peran Anda tidak bisa mengelola kunci API.</p>;
  }

  const keys = data?.keys ?? [];
  const live = keys.filter((k) => !k.revoked_at);

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-display">Kunci API</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Kunci dipakai sistem Anda untuk mengirim dan membaca pesan. Buat satu kunci per sistem supaya bisa dicabut sendiri-sendiri tanpa mengganggu yang lain.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Buat kunci</Button>
      </div>

      {isLoading ? <Skeleton className="h-40 w-full" /> : isError ? (
        <p className="text-sm text-destructive">Gagal memuat kunci. Muat ulang halaman.</p>
      ) : live.length === 0 && keys.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-14 text-center">
          <KeyRound className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Belum ada kunci</p>
            <p className="text-sm text-muted-foreground">Buat kunci pertama untuk mulai mengirim pesan dari kode Anda.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>Buat kunci</Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Awalan</TableHead>
                <TableHead>Izin</TableHead>
                <TableHead>Terakhir dipakai</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"><span className="sr-only">Aksi</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const state = keyState(k);
                const inactive = Boolean(k.revoked_at) || (k.expires_at ? new Date(k.expires_at) <= new Date() : false);
                return (
                  <TableRow key={k.id} className={inactive ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                    <TableCell>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {k.scopes.map((s) => <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-xs">{SCOPE_LABEL[s] ?? s}</span>)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{k.last_used_at ? formatDate(k.last_used_at) : "Belum pernah"}</TableCell>
                    <TableCell className="whitespace-nowrap"><span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><span className={`h-2 w-2 rounded-full ${state.tone}`} />{state.label}</span></TableCell>
                    <TableCell>
                      {!inactive && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${k.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => rotate.mutate(k.id, { onSuccess: (key) => setReveal({ key, rotated: true }) })}>
                              <RotateCw className="mr-2 h-4 w-4" />Putar kunci
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setToRevoke(k)}>
                              <Trash2 className="mr-2 h-4 w-4" />Cabut
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        <strong>Putar kunci</strong> membuat kunci baru dengan izin yang sama, dan kunci lama tetap berlaku 24 jam supaya Anda sempat mengganti di server tanpa downtime.
      </p>

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(key) => setReveal({ key, rotated: false })} />

      {reveal && (
        <SecretReveal
          open
          title={reveal.rotated ? "Kunci baru siap" : "Kunci API dibuat"}
          description={reveal.rotated ? "Kunci lama masih berlaku 24 jam. Ganti di sistem Anda sebelum itu." : `Kunci “${reveal.key.name}” sudah aktif.`}
          secret={reveal.key.key}
          onDone={() => setReveal(null)}
        />
      )}

      <Dialog open={toRevoke !== null} onOpenChange={(o) => !o && setToRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cabut kunci “{toRevoke?.name}”?</DialogTitle>
            <DialogDescription>Sistem yang memakai kunci ini langsung berhenti bisa mengirim atau membaca pesan. Tindakan ini tidak bisa dibatalkan.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToRevoke(null)}>Batal</Button>
            <Button variant="destructive" disabled={revoke.isPending} onClick={() => toRevoke && revoke.mutate(toRevoke.id, { onSuccess: () => setToRevoke(null) })}>Cabut kunci</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
