"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function DeviceMediaRetention({ deviceKey, canEdit }: { deviceKey: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["device-media-retention", deviceKey], queryFn: () => api.getDeviceMediaRetention(deviceKey) });
  const [value, setValue] = useState("30");
  useEffect(() => {
    if (query.data) setValue(query.data.media_retention_days === null ? "forever" : String(query.data.media_retention_days));
  }, [query.data]);
  const update = useMutation({
    mutationFn: () => api.updateDeviceMediaRetention(deviceKey, value === "forever" ? null : Number(value)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["device-media-retention", deviceKey] });
      toast.success("Masa simpan media diperbarui");
    },
    onError: (error) => toast.error("Pengaturan gagal disimpan", { description: apiFailure(error).message }),
  });
  return <section className="max-w-2xl space-y-4 rounded-xl border bg-card p-5 shadow-card">
    <div>
      <h3 className="font-semibold">Masa simpan foto dan video</h3>
      <p className="mt-1 text-sm text-muted-foreground">Media percakapan disimpan privat supaya bisa dibuka kembali di inbox. Pengaturan ini berlaku untuk media baru dan yang sudah tersimpan.</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Select value={value} onValueChange={setValue} disabled={!canEdit || query.isLoading || update.isPending}>
        <SelectTrigger className="w-56" aria-label="Masa simpan media"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Hapus setelah 1 hari</SelectItem>
          <SelectItem value="7">Hapus setelah 7 hari</SelectItem>
          <SelectItem value="30">Hapus setelah 30 hari</SelectItem>
          <SelectItem value="90">Hapus setelah 90 hari</SelectItem>
          <SelectItem value="forever">Simpan sampai dihapus</SelectItem>
        </SelectContent>
      </Select>
      {canEdit && <Button type="button" onClick={() => update.mutate()} disabled={query.isLoading || update.isPending || (query.data && value === String(query.data.media_retention_days ?? "forever"))}>
        {update.isPending ? "Menyimpan…" : "Simpan"}
      </Button>}
    </div>
    <p className="text-xs text-muted-foreground">Foto/video tersimpan sebagai berkas privat; pesan dan keterangannya tetap ada di riwayat setelah berkas kedaluwarsa.</p>
  </section>;
}
