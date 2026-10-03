"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Permission } from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";

/** The signed-in person, their workspace and what they may do. */
export function useMe() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ["me", api.getSession()],
    queryFn: () => api.getMe(),
    enabled: isAuthenticated === true,
    staleTime: 60_000,
    retry: false,
  });
}

export function usePermissions() {
  const me = useMe();
  const can = useCallback(
    (permission: Permission): boolean => Boolean(me.data?.permissions.includes(permission)),
    [me.data],
  );
  return {
    can,
    role: me.data?.workspace.role,
    user: me.data?.user,
    workspace: me.data?.workspace,
    isLoading: me.isLoading,
  };
}
