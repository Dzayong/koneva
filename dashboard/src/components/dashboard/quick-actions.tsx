"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddDeviceForm } from "@/components/devices/add-device-form";
import { usePermissions } from "@/hooks/use-me";

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { can } = usePermissions();
  if (!can("devices:write")) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Tambah nomor
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah nomor</DialogTitle>
            <DialogDescription>Sambungkan nomor WhatsApp baru ke workspace Anda.</DialogDescription>
          </DialogHeader>
          <AddDeviceForm onSuccess={(device) => { setOpen(false); router.push(`/devices/${device.device_key}?connect=1`); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
