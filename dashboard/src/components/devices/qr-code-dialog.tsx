"use client";

import { QRCodeSVG } from "qrcode.react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeviceQR } from "@/hooks/use-device";

export function QRCodeDialog({
  deviceKey,
  open,
  onOpenChange,
}: {
  deviceKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useDeviceQR(deviceKey, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan to connect</DialogTitle>
          <DialogDescription>
            Open WhatsApp on the phone for {deviceKey} → Linked devices → Link a device.
            Refreshes automatically every few seconds.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-64 items-center justify-center">
          {isLoading && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
          {isError && (
            <p className="text-center text-sm text-muted-foreground">
              QR code isn&apos;t available right now. The device may already be connected or
              hasn&apos;t generated one yet.
            </p>
          )}
          {data?.qr_code && (
            <div className="rounded-lg border bg-white p-4">
              <QRCodeSVG value={data.qr_code} size={224} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
