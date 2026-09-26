"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Radio, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TemplateBuilder } from "@/components/messages/template-builder";
import { useDevices } from "@/hooks/use-devices";
import { useRecipientContacts } from "@/hooks/use-contacts";
import { api } from "@/lib/api";
import { renderSpintax } from "@/lib/spintax";
import { formatPhoneNumber } from "@/lib/utils";

type SendStatus = "pending" | "sending" | "queued" | "failed";

interface RecipientState {
  phone: string;
  name: string;
  status: SendStatus;
  error?: string;
}

// api-gateway currently sends each message in its own request/transaction —
// this small delay between requests is a client-side courtesy (don't
// hammer the API in a tight loop), not a substitute for anti-ban.ts's real
// pacing, which still applies per-message server-side regardless.
const BROADCAST_SEND_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BroadcastPage() {
  const { data: devices } = useDevices();
  const { contacts } = useRecipientContacts();

  const onlineDevices = useMemo(() => devices?.filter((d) => d.status === "online") ?? [], [devices]);
  const [deviceKey, setDeviceKey] = useState("");
  const [template, setTemplate] = useState("");
  const [manualNumbers, setManualNumbers] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [recipients, setRecipients] = useState<RecipientState[]>([]);
  const [isSending, setIsSending] = useState(false);

  const toggleContact = (id: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildRecipientList = (): RecipientState[] => {
    const fromContacts = contacts
      .filter((c) => selectedContactIds.has(c.id))
      .map((c) => ({ phone: c.phone, name: c.name }));
    const fromManual = manualNumbers
      .split(/[\n,]/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((phone) => ({ phone: phone.replace(/\D/g, ""), name: "" }));

    const seen = new Set<string>();
    const merged: RecipientState[] = [];
    for (const r of [...fromContacts, ...fromManual]) {
      if (!r.phone || seen.has(r.phone)) continue;
      seen.add(r.phone);
      merged.push({ ...r, status: "pending" });
    }
    return merged;
  };

  const handleSend = async () => {
    if (!deviceKey) {
      toast.error("Pick a device first");
      return;
    }
    if (!template.trim()) {
      toast.error("Write a message first");
      return;
    }
    const list = buildRecipientList();
    if (list.length === 0) {
      toast.error("No recipients", { description: "Select contacts or paste phone numbers." });
      return;
    }

    setRecipients(list);
    setIsSending(true);

    for (let i = 0; i < list.length; i++) {
      const recipient = list[i]!;
      setRecipients((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "sending" } : r)),
      );

      const content = renderSpintax(template, { nama: recipient.name || recipient.phone });

      try {
        await api.sendMessage({ device_key: deviceKey, to: recipient.phone, message: content });
        setRecipients((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "queued" } : r)),
        );
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err ? String(err.message) : "Failed";
        setRecipients((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: message } : r)),
        );
      }

      if (i < list.length - 1) await sleep(BROADCAST_SEND_DELAY_MS);
    }

    setIsSending(false);
    toast.success("Broadcast finished", {
      description: "Check the table below for per-recipient results.",
    });
  };

  const recipientCount = selectedContactIds.size + manualNumbers.split(/[\n,]/).filter((n) => n.trim()).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-display">Broadcast</h2>
        <p className="text-muted-foreground">
          Send a templated message to multiple recipients. Each one still goes through the
          normal anti-ban gate server-side — this doesn&apos;t bypass rate limits or warm-up caps.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Device</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={deviceKey} onValueChange={setDeviceKey}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an online device" />
                </SelectTrigger>
                <SelectContent>
                  {onlineDevices.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">No online devices</div>
                  ) : (
                    onlineDevices.map((d) => (
                      <SelectItem key={d.id} value={d.device_key}>
                        {d.label || d.device_key}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Recipients ({recipientCount})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {contacts.length > 0 && (
                <div className="space-y-2">
                  <Label>From contacts</Label>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {contacts.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedContactIds.has(c.id)}
                          onChange={() => toggleContact(c.id)}
                        />
                        {c.name} — {formatPhoneNumber(c.phone)}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="manualNumbers">Or paste phone numbers (one per line)</Label>
                <Textarea
                  id="manualNumbers"
                  rows={4}
                  placeholder={"6281234567890\n6281234567891"}
                  value={manualNumbers}
                  onChange={(e) => setManualNumbers(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>3. Message</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateBuilder value={template} onChange={setTemplate} />
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSend} disabled={isSending} size="lg">
        {isSending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <Radio className="mr-2 h-4 w-4" />
            Send Broadcast
          </>
        )}
      </Button>

      {recipients.length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => (
                <TableRow key={r.phone}>
                  <TableCell>
                    {r.name ? `${r.name} — ` : ""}
                    {formatPhoneNumber(r.phone)}
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" && (
                      <span className="text-muted-foreground">Pending</span>
                    )}
                    {r.status === "sending" && (
                      <span className="flex items-center gap-1 text-blue-600">
                        <Loader2 className="h-3 w-3 animate-spin" /> Sending
                      </span>
                    )}
                    {r.status === "queued" && (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Queued
                      </span>
                    )}
                    {r.status === "failed" && (
                      <span className="flex items-center gap-1 text-red-600">
                        <XCircle className="h-3 w-3" /> {r.error || "Failed"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
