"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateDevice } from "@/hooks/use-devices";

const schema = z.object({
  label: z.string().max(100).optional(),
  phone_number: z
    .string()
    .max(20)
    .regex(/^\+?\d*$/, "Digits only (optionally starting with +)")
    .optional(),
});

type FormValues = z.infer<typeof schema>;

export function AddDeviceForm({ onSuccess }: { onSuccess: () => void }) {
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
        <Label htmlFor="label">Label</Label>
        <Input id="label" placeholder="e.g. Sales Jakarta" {...register("label")} />
        {errors.label && <p className="text-sm text-destructive">{errors.label.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone_number">Phone number (optional)</Label>
        <Input id="phone_number" placeholder="+6281234567890" {...register("phone_number")} />
        {errors.phone_number && (
          <p className="text-sm text-destructive">{errors.phone_number.message}</p>
        )}
      </div>
      {createDevice.isError && (
        <p className="text-sm text-destructive">
          This backend doesn&apos;t support tenant self-service device creation yet
          (needs <code>POST /api/v1/devices</code> on api-gateway) — ask an admin to run{" "}
          <code>POST /admin/device/create</code> for now.
        </p>
      )}
      <Button type="submit" className="w-full" disabled={createDevice.isPending}>
        {createDevice.isPending ? "Creating..." : "Create Device"}
      </Button>
    </form>
  );
}
