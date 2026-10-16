"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, CreditCard, MessageSquare, Plus, Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddDeviceForm } from "@/components/devices/add-device-form";
import { usePermissions } from "@/hooks/use-me";

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { can } = usePermissions();

  const actions = [
    can("messages:send") && { label: "Kirim pesan", href: "/messages", icon: MessageSquare },
    can("messages:send") && { label: "Buat broadcast", href: "/broadcast", icon: Radio },
    can("messages:read") && { label: "Kelola kontak", href: "/contacts", icon: Users },
    can("billing:manage") && { label: "Tagihan", href: "/billing", icon: CreditCard },
    can("messages:send") && { label: "Dokumentasi API", href: "/developers/quickstart", icon: BookOpen },
  ].filter((action): action is { label: string; href: string; icon: typeof MessageSquare } => Boolean(action));

  if (actions.length === 0 && !can("devices:write")) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pintasan</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {can("devices:write") && (
            <Button variant="outline" className="justify-start" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />Tambah device
            </Button>
          )}
          {actions.map(({ label, href, icon: Icon }) => (
            <Button key={href} variant="outline" className="justify-start" asChild>
              <Link href={href}><Icon className="mr-2 h-4 w-4" />{label}</Link>
            </Button>
          ))}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah device</DialogTitle>
            <DialogDescription>Sambungkan device WhatsApp baru ke workspace Anda.</DialogDescription>
          </DialogHeader>
          <AddDeviceForm onSuccess={(device) => { setOpen(false); router.push(`/devices/${device.device_key}?connect=1`); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
