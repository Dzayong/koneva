"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateDevice } from "@/hooks/use-devices";
import { apiFailure } from "@/lib/errors";
import type { Device } from "@/lib/types";

const schema = z.object({
  label: z.string().max(100).optional(),
  phone_number: z
    .string()
    .max(20)
    .regex(/^\+?\d*$/, "Hanya angka (boleh diawali +)")
    .optional(),
});

function errorMessage(error: unknown): string {
  const failure = apiFailure(error, "Gagal membuat nomor.");
  if (failure.status === 429) return "Batas jumlah nomor untuk paket ini sudah tercapai.";
  if (failure.status === 403) return "Peran Anda tidak bisa menambah nomor.";
  if (failure.status === 404) return "Fitur ini belum tersedia di server.";
  return failure.message;
}

type FormValues = z.infer<typeof schema>;

export function AddDeviceForm({ onSuccess }: { onSuccess: (device: Device) => void }) {
  const createDevice = useCreateDevice();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit((values) => {
    createDevice.mutate(
      { label: values.label || undefined, phone_number: values.phone_number || undefined },
      { onSuccess },
    );
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="label">Nama device</Label>
        <Input id="label" placeholder="mis. CS Jakarta" autoFocus {...register("label")} />
        <p className="text-xs text-muted-foreground">Untuk membedakan nomor di dashboard. Boleh dikosongkan.</p>
        {errors.label && <p className="text-sm text-destructive">{errors.label.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone_number">Nomor WhatsApp <span className="font-normal text-muted-foreground">(opsional)</span></Label>
        <Input id="phone_number" inputMode="tel" placeholder="+6281234567890" {...register("phone_number")} />
        {errors.phone_number && <p className="text-sm text-destructive">{errors.phone_number.message}</p>}
      </div>
      {createDevice.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(createDevice.error)}</p>}
      <Button type="submit" className="w-full" disabled={createDevice.isPending}>
        {createDevice.isPending ? "Menyiapkan nomor…" : "Lanjut ke pemindaian QR"}
      </Button>
    </form>
  );
}
