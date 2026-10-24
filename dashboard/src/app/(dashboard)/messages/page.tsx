"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Loader2, MessageSquare, Search, Send, Smartphone, Users } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageStatusBadge } from "@/components/messages/message-status-badge";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";
import { formatDate, formatPhoneNumber, formatShortRelative } from "@/lib/utils";
import { useInboxConversations, useInboxDevices, useInboxMessages } from "@/hooks/use-messages";
import type { InboxConversation } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const ALL = "all";
const conversationId = (item: InboxConversation) => `${item.device_key}::${item.chat_key}`;
const peerLabel = (item: InboxConversation, groupName?: string) => item.chat_key.endsWith("@g.us")
  ? groupName || `Grup WhatsApp · ${item.chat_key.replace(/@.*$/, "")}`
  : item.contact_name || formatPhoneNumber(item.peer_number || item.chat_key.replace(/@.*$/, "")) || "Nomor tidak dikenal";
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("id-ID") || "?";
const messagePreview = (item: InboxConversation) => item.type === "text" ? item.content : item.content || `[${item.type}]`;

export default function MessagesPage() {
  const [deviceKey, setDeviceKey] = useState(ALL);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const queryClient = useQueryClient();
  const devices = useInboxDevices();
  const onlineDevices = (devices.data ?? []).filter((device) => device.status === "online");
  const groupQueries = useQueries({ queries: onlineDevices.map((device) => ({
    queryKey: ["whatsapp-groups", device.device_key],
    queryFn: () => api.getWhatsAppGroups(device.device_key),
    staleTime: 30_000,
    retry: false,
  })) });
  const groupsByChat = useMemo(() => {
    const map = new Map<string, { name: string; imageUrl: string | null }>();
    groupQueries.forEach((query, index) => {
      for (const group of query.data ?? []) map.set(`${onlineDevices[index]?.device_key}::${group.id}`, { name: group.name, imageUrl: group.image_url ?? null });
    });
    return map;
  }, [groupQueries, onlineDevices]);
  const conversations = useInboxConversations({
    ...(deviceKey !== ALL ? { device_key: deviceKey } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  const selected = useMemo(() => {
    const rows = conversations.data ?? [];
    return rows.find((item) => conversationId(item) === selectedKey) ?? rows[0] ?? null;
  }, [conversations.data, selectedKey]);
  const messages = useInboxMessages(
    { device_key: selected?.device_key ?? "", chat_key: selected?.chat_key ?? "" },
    !!selected,
  );
  const orderedMessages = useMemo(() => messages.data?.messages ?? [], [messages.data]);
  const latestInbound = useMemo(
    () => [...orderedMessages].reverse().find((message) => message.direction === "inbound"),
    [orderedMessages],
  );
  const sourceDevice = devices.data?.find((device) => device.device_key === selected?.device_key);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const replyWindowOpen = !!latestInbound && now - new Date(latestInbound.created_at).getTime() <= 24 * 60 * 60 * 1000;
  const isGroup = !!selected?.chat_key.endsWith("@g.us");
  const groupMeta = selected ? groupsByChat.get(`${selected.device_key}::${selected.chat_key}`) : undefined;
  const groupDetails = useQuery({
    queryKey: ["whatsapp-group-details", selected?.device_key, selected?.chat_key],
    queryFn: () => api.getWhatsAppGroupDetails(selected!.device_key, selected!.chat_key),
    enabled: Boolean(selected && isGroup && devices.data?.some((device) => device.device_key === selected.device_key && device.status === "online")),
    retry: false,
    staleTime: 30_000,
  });
  const participantNames = useMemo(() => new Map((groupDetails.data?.participants ?? []).map((person) => [person.id.replace(/@.*$/, "").replace(/\D/g, ""), person.name])), [groupDetails.data]);

  const reply = useMutation({
    mutationFn: () => api.replyInboxMessage(latestInbound!.id, draft.trim()),
    onSuccess: () => {
      setDraft("");
      toast.success("Balasan masuk antrean");
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (error) => toast.error("Balasan gagal dikirim", { description: apiFailure(error).message }),
  });

  const chooseConversation = (item: InboxConversation) => {
    setSelectedKey(conversationId(item));
    setMobileChatOpen(true);
  };

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-heading">Pesan</h2>
        <p className="text-muted-foreground">Semua percakapan dari device yang terhubung, dalam satu kotak masuk.</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Cari nomor atau isi pesan…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Select value={deviceKey} onValueChange={setDeviceKey}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Pilih device"><SelectValue placeholder="Semua device" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua device</SelectItem>
            {devices.data?.map((device) => <SelectItem key={device.device_key} value={device.device_key}>{device.label || device.device_key}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <section className="grid h-[68dvh] min-h-[420px] max-h-[760px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl border bg-card shadow-card lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.8fr)]" aria-label="Kotak masuk percakapan">
        <div className={`${mobileChatOpen ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r`}>
          <div className="flex h-12 items-center justify-between border-b px-4 text-sm">
            <span className="font-semibold">Percakapan</span>
            <span className="text-muted-foreground">{conversations.data?.length ?? 0}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {conversations.isLoading ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-[76px] w-full rounded-none" />)
              : (conversations.data?.length ?? 0) > 0 ? conversations.data!.map((item) => {
                const active = selected && conversationId(selected) === conversationId(item);
                const Arrow = item.direction === "inbound" ? ArrowDownLeft : ArrowUpRight;
                const group = item.chat_key.endsWith("@g.us");
                const meta = groupsByChat.get(`${item.device_key}::${item.chat_key}`);
                const label = peerLabel(item, meta?.name);
                return (
                  <button key={conversationId(item)} type="button" onClick={() => chooseConversation(item)} aria-current={active ? "true" : undefined}
                    className={`flex w-full flex-col gap-1.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50 ${active ? "bg-accent" : ""}`}>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Avatar className="h-9 w-9 shrink-0"><AvatarImage src={group ? meta?.imageUrl ?? undefined : undefined} alt="" /><AvatarFallback className="bg-primary/10 text-primary">{group ? <Users className="h-4 w-4" /> : initials(item.contact_name || label)}</AvatarFallback></Avatar><span className="truncate">{label}</span></span>
                      <time className="shrink-0 text-xs text-muted-foreground" title={formatDate(item.created_at)}>{formatShortRelative(item.created_at)}</time>
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-10">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"><Arrow className="h-3 w-3 shrink-0" />{messagePreview(item)}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><Smartphone className="h-3 w-3" />{item.device_label || item.device_key}</span>
                    </div>
                  </button>
                );
              }) : <div className="px-6 py-16 text-center text-sm text-muted-foreground">{conversations.isError ? "Percakapan gagal dimuat." : "Belum ada percakapan."}</div>}
          </div>
        </div>

        <div className={`${mobileChatOpen ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}>
          {selected ? <>
            <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
              <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" aria-label="Kembali ke percakapan" onClick={() => setMobileChatOpen(false)}><ArrowLeft className="h-4 w-4" /></Button>
              <Avatar className="h-10 w-10 shrink-0"><AvatarImage src={groupMeta?.imageUrl ?? undefined} alt="" /><AvatarFallback className="bg-primary/10 text-primary">{isGroup ? <Users className="h-5 w-5" /> : initials(selected.contact_name || peerLabel(selected))}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{peerLabel(selected, groupMeta?.name)}</p><p className="truncate text-xs text-muted-foreground">{selected.device_label || selected.device_key} · {sourceDevice?.status === "online" ? "Online" : sourceDevice?.status || "Device"}</p></div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-5 sm:px-6">
              {messages.hasNextPage && <div className="flex justify-center"><Button type="button" variant="outline" size="sm" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>{messages.isFetchingNextPage ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Memuat…</> : "Muat pesan sebelumnya"}</Button></div>}
              {messages.isLoading ? <div className="space-y-3"><Skeleton className="h-16 w-2/3" /><Skeleton className="ml-auto h-16 w-2/3" /></div>
                : orderedMessages.map((message) => {
                  const inbound = message.direction === "inbound";
                  return <div key={message.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[88%] rounded-xl px-3.5 py-2.5 shadow-sm sm:max-w-[75%] ${inbound ? "rounded-tl-sm border bg-card" : "rounded-tr-sm bg-primary text-primary-foreground"}`}>
                      {inbound && isGroup && <p className="mb-1 text-xs font-semibold text-primary">{participantNames.get((message.from_number ?? "").replace(/\D/g, "")) || formatPhoneNumber(message.from_number ?? "") || "Anggota grup"}</p>}
                      <p className="whitespace-pre-wrap break-words text-sm">{message.content || `[${message.type}]`}</p>
                      <div className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${inbound ? "text-muted-foreground" : "text-primary-foreground/75"}`}><time title={formatDate(message.created_at)}>{new Date(message.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>{!inbound && <MessageStatusBadge status={message.status} errorMessage={message.error_message} />}</div>
                    </div>
                  </div>;
                })}
              {!messages.isLoading && orderedMessages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Belum ada pesan pada percakapan ini.</p>}
            </div>
            <form className="space-y-2 border-t bg-card p-3 sm:p-4" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) reply.mutate(); }}>
              {!replyWindowOpen ? <p className="text-xs text-muted-foreground">Balasan tersedia sampai 24 jam setelah pesan pelanggan. Minta pelanggan mengirim pesan baru untuk membuka kembali percakapan.</p>
                : sourceDevice?.status !== "online" ? <p className="text-xs text-amber-700">Device pengirim sedang {sourceDevice?.status ?? "tidak tersedia"}. Sambungkan kembali device tersebut untuk membalas.</p>
                  : <p className="text-xs text-muted-foreground">Balasan dikirim melalui {selected.device_label || selected.device_key}{isGroup ? " ke grup ini" : ""} dan tetap mengikuti aturan saldo serta izin penerima.</p>}
              <div className="flex items-end gap-2"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4096} rows={2} disabled={!replyWindowOpen || sourceDevice?.status !== "online" || reply.isPending} placeholder="Tulis balasan…" aria-label="Tulis balasan" />
                <Button type="submit" size="icon" aria-label="Kirim balasan" disabled={!draft.trim() || !replyWindowOpen || sourceDevice?.status !== "online" || reply.isPending}>{reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div>
            </form>
          </> : <div className="hidden flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground lg:flex"><MessageSquare className="h-10 w-10" /><p>Pilih percakapan untuk melihat pesan dan membalas.</p></div>}
          {conversations.isError && selected && <p className="border-t px-4 py-2 text-xs text-destructive">Daftar percakapan tidak dapat diperbarui.</p>}
        </div>
      </section>
    </div>
  );
}
