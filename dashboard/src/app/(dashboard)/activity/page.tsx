"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuditLog } from "@/hooks/use-developer";
import { usePermissions } from "@/hooks/use-me";
import { formatDate } from "@/lib/utils";

const ACTION: Record<string, string> = {
  "devices.create": "Menambah device",
  "webhook.secret_rotate": "Membuat kunci webhook baru",
  "status.post": "Memposting status WhatsApp",
  "profile.update": "Mengubah profil device",
  "profile.picture": "Mengganti foto profil device",
  "profile.picture_remove": "Menghapus foto profil device",
  "devices.pause": "Menjeda device",
  "devices.resume": "Melanjutkan device",
  "devices.persona_update": "Mengubah pengaturan pengiriman",
  "devices.preset_apply": "Menerapkan peran device",
  "devices.delete": "Menghapus device",
  "webhook.update": "Mengubah webhook",
  "keys.create": "Membuat kunci API",
  "keys.rotate": "Memutar kunci API",
  "keys.revoke": "Mencabut kunci API",
  "team.invite": "Mengundang anggota",
  "team.invite_revoke": "Membatalkan undangan",
  "team.role_change": "Mengubah peran anggota",
  "team.remove": "Mengeluarkan anggota",
  "team.join": "Bergabung ke workspace",
  "broadcast.create": "Membuat broadcast",
  "auto_reply.create": "Membuat balasan otomatis",
  "auto_reply.update": "Mengubah balasan otomatis",
  "auto_reply.toggle": "Menyalakan atau mematikan balasan otomatis",
  "auto_reply.delete": "Menghapus balasan otomatis",
};

export default function ActivityPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useAuditLog();

  if (!permsLoading && !can("audit:read")) {
    return <p className="text-muted-foreground">Peran Anda tidak bisa melihat aktivitas workspace.</p>;
  }

  const rows = data?.pages.flat() ?? [];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-display">Aktivitas</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Siapa melakukan apa di workspace ini. Pengiriman pesan tidak dicatat di sini; lihat halaman Pesan untuk itu.</p>
      </div>

      {isLoading ? <Skeleton className="h-48 w-full" /> : isError ? (
        <p className="text-sm text-destructive">Gagal memuat aktivitas. Muat ulang halaman.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Belum ada aktivitas. Menambah device, membuat kunci, atau mengundang rekan akan muncul di sini.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Oleh</TableHead><TableHead>Tindakan</TableHead><TableHead>Sasaran</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="text-sm">{r.actor_label ?? "Sistem"}{r.actor_type === "api_key" && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">API</span>}</TableCell>
                  <TableCell className="text-sm font-medium">{ACTION[r.action] ?? r.action}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.target_id ? (r.target_id.length > 14 ? `${r.target_id.slice(0, 8)}…` : r.target_id) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {hasNextPage && <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>{isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}</Button>}
    </div>
  );
}
