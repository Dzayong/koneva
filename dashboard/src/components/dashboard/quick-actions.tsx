"use client";

import { useState } from "react";
import { ChevronDown, Plus, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddDeviceForm } from "@/components/devices/add-device-form";

export function QuickActions() {
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            Quick Actions
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setAddDeviceOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Device
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              toast.info("Not available yet", {
                description: "Broadcast sending isn't implemented in the backend yet.",
              })
            }
          >
            <Radio className="mr-2 h-4 w-4" />
            Send Broadcast
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={addDeviceOpen} onOpenChange={setAddDeviceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Device</DialogTitle>
            <DialogDescription>Connect a new WhatsApp number to your account.</DialogDescription>
          </DialogHeader>
          <AddDeviceForm onSuccess={() => setAddDeviceOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
