import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ContactListParams, CreateContactRequest, CreateScheduledCampaign } from "@/lib/types";

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const code = error.response?.data?.error?.code;
    if (code === "VALIDATION_ERROR") return "Check the phone number format (e.g. +6281234567890).";
    return error.response?.data?.error?.message ?? fallback;
  }
  return fallback;
}

export function useContacts(params: ContactListParams = {}) {
  return useQuery({
    queryKey: ["contacts", params],
    queryFn: () => api.getContacts(params),
    placeholderData: keepPreviousData,
  });
}

/** Up to 100 contacts as simple {id,name,phone} — the recipient picker for Broadcast. */
export function useRecipientContacts() {
  const { data } = useContacts({ limit: 100, offset: 0 });
  const contacts = (data?.data ?? []).map((c) => ({
    id: c.id,
    name: c.name ?? "",
    phone: c.phone_number,
  }));
  return { contacts, total: data?.pagination.total ?? 0 };
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateContactRequest) => api.createContact(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Kontak ditambahkan");
    },
  });
}

export function useSetContactConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, source_note }: { id: string; status: "opted_in" | "opted_out"; source_note: string }) =>
      api.setContactConsent(id, status, source_note),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Persetujuan penerima dicatat");
    },
    onError: (error) => toast.error("Kontak tersimpan, tetapi persetujuan gagal dicatat", {
      description: apiErrorMessage(error, "Buka kembali kontak lalu catat persetujuannya."),
    }),
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Kontak dihapus");
    },
  });
}

export function useImportContacts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { csv: string; consent_source_note?: string }) =>
      typeof input === "string" ? api.importContacts(input) : api.importContacts(input.csv, input.consent_source_note),
    onSuccess: ({ imported }) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(`${imported} kontak diimpor`);
    },
    onError: (error) =>
      toast.error("Impor gagal", {
        description: apiErrorMessage(error, 'CSV needs a "phone_number" (or "phone") header column.'),
      }),
  });
}

/** phone digits → contact name, for labelling message rows (first 100 contacts). */
export function useContactNames(): Map<string, string> {
  const { data } = useContacts({ limit: 100, offset: 0 });
  const map = new Map<string, string>();
  for (const c of data?.data ?? []) {
    if (c.name) map.set(c.phone_number.replace(/\D/g, ""), c.name);
  }
  return map;
}

export function useContactGroups() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ["contact-groups"], queryFn: () => api.getContactGroups() });
  const create = useMutation({ mutationFn: (name: string) => api.createContactGroup(name), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contact-groups"] }) });
  const members = useMutation({
    mutationFn: ({ id, contact_ids }: { id: string; contact_ids: string[] }) => api.replaceContactGroupMembers(id, contact_ids),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contact-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["contact-group-members", variables.id] }),
      ]);
      toast.success("Anggota grup disimpan");
    },
    onError: (error) => toast.error("Gagal menyimpan anggota grup", {
      description: apiErrorMessage(error, "Coba lagi beberapa saat."),
    }),
  });
  return { ...groups, createGroup: create, saveMembers: members };
}

export function useScheduledCampaigns() {
  const queryClient = useQueryClient();
  const campaigns = useQuery({ queryKey: ["scheduled-campaigns"], queryFn: () => api.getScheduledCampaigns(), refetchInterval: 15_000 });
  const create = useMutation({ mutationFn: (input: CreateScheduledCampaign) => api.createScheduledCampaign(input), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled-campaigns"] }) });
  const cancel = useMutation({ mutationFn: (id: string) => api.cancelScheduledCampaign(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled-campaigns"] }) });
  return { ...campaigns, createCampaign: create, cancelCampaign: cancel };
}
