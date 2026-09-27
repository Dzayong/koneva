import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiFailure } from "@/lib/errors";

const fail = (title: string) => (error: unknown) => toast.error(title, { description: apiFailure(error).message });

export function useApiKeys() {
  return useQuery({ queryKey: ["api-keys"], queryFn: () => api.getApiKeys(), retry: false });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; scopes: string[]; expires_in_days?: number }) => api.createApiKey(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: fail("Gagal membuat kunci"),
  });
}

export function useRotateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rotateApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: fail("Gagal memutar kunci"),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["api-keys"] }); toast.success("Kunci dicabut"); },
    onError: fail("Gagal mencabut kunci"),
  });
}

export function useTeam() {
  return useQuery({ queryKey: ["team"], queryFn: () => api.getTeam(), retry: false });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: "developer" }) => api.inviteMember(email, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team"] }),
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["team"] }); toast.success("Undangan dibatalkan"); },
    onError: fail("Gagal membatalkan undangan"),
  });
}

export function useChangeRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "developer" }) => api.changeMemberRole(userId, role),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["team"] }); toast.success("Peran diubah"); },
    onError: fail("Gagal mengubah peran"),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["team"] }); toast.success("Anggota dikeluarkan"); },
    onError: fail("Gagal mengeluarkan anggota"),
  });
}

const AUDIT_PAGE = 50;

export function useAuditLog() {
  return useInfiniteQuery({
    queryKey: ["audit"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.getAudit(AUDIT_PAGE, pageParam),
    getNextPageParam: (last) => (last.length === AUDIT_PAGE ? last[last.length - 1]?.created_at : undefined),
    retry: false,
  });
}
