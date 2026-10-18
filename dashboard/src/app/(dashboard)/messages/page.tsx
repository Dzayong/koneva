"use client";

import { getMessageStatusConfig } from "@/lib/utils";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageDetail, MessageRow, messageNumber } from "@/components/messages/message-item";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useContactNames } from "@/hooks/use-contacts";
import { useDevices } from "@/hooks/use-devices";
import { useMessages } from "@/hooks/use-messages";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";
import type { Message, MessageStatus } from "@/lib/types";

const PAGE_SIZE = 20;
const ALL = "all";

function ReplyComposer({ message }: { message: Message }) {
  const [text, setText] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [message.id]);
  const replyWindowOpen = now !== null && now - new Date(message.created_at).getTime() <= 24 * 60 * 60 * 1000;
  const send = useMutation({
    mutationFn: () => api.sendMessage({
      device_key: message.device_key,
      to: message.from_number!,
      message: text.trim(),
      reply_to_message_id: message.id,
    }),
    onSuccess: (result) => {
      toast.success(result.status === "quota_hold" ? "Balasan disimpan, menunggu kuota" : "Balasan masuk antrean");
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error) => toast.error("Balasan gagal dikirim", { description: apiFailure(error).message }),
  });

  if (message.direction !== "inbound" || !message.from_number) return null;
  if (!replyWindowOpen) {
    return <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">Waktu untuk membalas pesan ini sudah lewat 24 jam. Minta pelanggan menghubungi Anda kembali sebelum membalas.</p>;
  }

  return (
    <form className="space-y-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); if (text.trim()) send.mutate(); }}>
      <label htmlFor={`reply-${message.id}`} className="text-sm font-medium">Balas percakapan</label>
      <Textarea id={`reply-${message.id}`} rows={3} maxLength={4096} value={text} onChange={(event) => setText(event.target.value)} placeholder="Tulis balasan ke pelanggan…" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Balasan ini merujuk ke pesan pelanggan yang dipilih.</p>
        <Button type="submit" disabled={!text.trim() || send.isPending}>{send.isPending ? "Mengirim…" : "Kirim balasan"}</Button>
      </div>
    </form>
  );
}

export default function MessagesPage() {
  const { data: devices } = useDevices();
  const contactNames = useContactNames();
  const [deviceKey, setDeviceKey] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [period, setPeriod] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isPlaceholderData } = useMessages({
    device_key: deviceKey === ALL ? undefined : deviceKey,
    status: status === ALL ? undefined : (status as MessageStatus),
    created_today: period === "today" ? true : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  // api-gateway has no phone-number search param, so this filters the
  // current page client-side rather than the whole result set.
  const filtered = useMemo(() => {
    if (!search.trim()) return data?.data ?? [];
    const needle = search.replace(/\D/g, "");
    return (data?.data ?? []).filter((m) => {
      const number = m.direction === "inbound" ? m.from_number : m.to_number;
      return number?.includes(needle) ?? false;
    });
  }, [data, search]);

  // Default to the first message on wide screens so the detail pane is never empty.
  const selected = filtered.find((m) => m.id === selectedId) ?? filtered[0] ?? null;

  const total = data?.pagination.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetToFirstPage = () => setOffset(0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-heading">Pesan</h2>
        <p className="text-muted-foreground">Riwayat dan status pengiriman dari semua nomor</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ringkasan menghitung pesan masuk dan keluar, semua status, non-sistem sejak 00.00 WIB. Pilih “Hari ini (WIB)” untuk melihat cakupan waktu yang sama.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari berdasarkan nomor telepon..."
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
            <SelectValue placeholder="Semua device" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua device</SelectItem>
            {devices?.map((d) => (
              <SelectItem key={d.id} value={d.device_key}>
                {d.label || d.device_key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={period}
          onValueChange={(value) => {
            setPeriod(value);
            resetToFirstPage();
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Rentang waktu">
            <SelectValue placeholder="Semua waktu" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua waktu</SelectItem>
            <SelectItem value="today">Hari ini (WIB)</SelectItem>
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
            <SelectValue placeholder="Semua status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua status</SelectItem>
            {(["queued", "sending", "sent", "delivered", "read", "failed", "blocked", "received"] as const).map(
              (s) => (
                <SelectItem key={s} value={s}>
                  {getMessageStatusConfig(s).label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="grid overflow-hidden rounded-2xl border bg-card shadow-card lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="max-h-[70vh] overflow-y-auto lg:border-r">
          {isLoading ? (
            <div className="space-y-px">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-none" />
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <ul>
              {filtered.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  selected={selected?.id === message.id}
                  contactName={contactNames.get(messageNumber(message).replace(/\D/g, ""))}
                  onSelect={() => {
                    setSelectedId(message.id);
                    if (window.innerWidth < 1024) setSheetOpen(true);
                  }}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">Tidak ada pesan</p>
            </div>
          )}
        </div>

        <div className="hidden p-6 lg:block">
          {selected ? (
            <div className="space-y-5">
              <MessageDetail
                message={selected}
                contactName={contactNames.get(messageNumber(selected).replace(/\D/g, ""))}
              />
              <ReplyComposer key={selected.id} message={selected} />
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Pilih pesan untuk membacanya.</p>
          )}
        </div>
      </div>

      <Sheet open={sheetOpen && !!selected} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-6 lg:hidden">
          <SheetTitle className="sr-only">Pesan</SheetTitle>
          {selected && (
            <div className="space-y-5">
              <MessageDetail
                message={selected}
                contactName={contactNames.get(messageNumber(selected).replace(/\D/g, ""))}
              />
              <ReplyComposer key={selected.id} message={selected} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Halaman {page} dari {totalPages} · {total} total
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPlaceholderData || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Berikutnya
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
