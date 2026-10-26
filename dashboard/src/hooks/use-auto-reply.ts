import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AutoReplyRuleInput, WorkspaceSendHours } from "@/lib/types";
import { apiErrorMessage } from "@/hooks/use-contacts";

const KEY = ["auto-reply-rules"];
const HOURS_KEY = ["workspace-send-hours"];

export function useWorkspaceSendHours() {
  return useQuery({ queryKey: HOURS_KEY, queryFn: () => api.getWorkspaceSendHours(), retry: false });
}

export function useUpdateWorkspaceSendHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceSendHours) => api.updateWorkspaceSendHours(input),
    onSuccess: (data) => {
      queryClient.setQueryData(HOURS_KEY, data);
      toast.success("Jam kerja workspace disimpan");
    },
    onError: (error) => toast.error("Gagal menyimpan jam kerja", { description: apiErrorMessage(error, "Coba lagi.") }),
  });
}

export function useAutoReplyRules() {
  return useQuery({ queryKey: KEY, queryFn: () => api.getAutoReplyRules(), retry: false });
}

export function useSaveAutoReplyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: AutoReplyRuleInput }) =>
      id ? api.updateAutoReplyRule(id, data) : api.createAutoReplyRule(data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(id ? "Aturan diperbarui" : "Aturan dibuat");
    },
  });
}

export function useToggleAutoReplyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.toggleAutoReplyRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (error) => toast.error("Gagal mengubah aturan", { description: apiErrorMessage(error, "Coba lagi.") }),
  });
}

export function useDeleteAutoReplyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAutoReplyRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast.success("Aturan dihapus");
    },
    onError: (error) => toast.error("Gagal menghapus aturan", { description: apiErrorMessage(error, "Coba lagi.") }),
  });
}
