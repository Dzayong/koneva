"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MessageStatusBadge } from "@/components/messages/message-status-badge";
import { useDevices } from "@/hooks/use-devices";
import { useMessages } from "@/hooks/use-messages";
import { formatDate, formatPhoneNumber, truncate } from "@/lib/utils";
import type { MessageStatus } from "@/lib/types";

const PAGE_SIZE = 20;
const ALL = "all";

export default function MessagesPage() {
  const { data: devices } = useDevices();
  const [deviceKey, setDeviceKey] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isPlaceholderData } = useMessages({
    device_key: deviceKey === ALL ? undefined : deviceKey,
    status: status === ALL ? undefined : (status as MessageStatus),
    limit: PAGE_SIZE,
    offset,
  });

  // api-gateway has no phone-number search param, so this filters the
  // current page client-side rather than the whole result set.
  const filtered = useMemo(() => {
    if (!search.trim()) return data?.data ?? [];
    const needle = search.replace(/\D/g, "");
    return (data?.data ?? []).filter((m) => m.to_number.includes(needle));
  }, [data, search]);

  const total = data?.pagination.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetToFirstPage = () => setOffset(0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Messages</h2>
        <p className="text-muted-foreground">History and delivery status across all devices</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by phone number..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={deviceKey}
          onValueChange={(value) => {
            setDeviceKey(value);
            resetToFirstPage();
          }}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All devices" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All devices</SelectItem>
            {devices?.map((d) => (
              <SelectItem key={d.id} value={d.device_key}>
                {d.label || d.device_key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            resetToFirstPage();
          }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(["queued", "sending", "sent", "delivered", "read", "failed", "blocked"] as const).map(
              (s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Content</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length > 0 ? (
              filtered.map((message) => (
                <TableRow key={message.id}>
                  <TableCell>{formatPhoneNumber(message.to_number)}</TableCell>
                  <TableCell className="max-w-xs">{truncate(message.content, 60)}</TableCell>
                  <TableCell className="text-muted-foreground">{message.device_key}</TableCell>
                  <TableCell>
                    <MessageStatusBadge status={message.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(message.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <MessageSquare className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">No messages found</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Page {page} of {totalPages} · {total} total
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPlaceholderData || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
