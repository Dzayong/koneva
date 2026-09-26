"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Permission, Role } from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";

/** The signed-in person, their workspace and what they may do. */
export function useMe() {
  const { isAuthenticated } = useAuth();
  const hasSession = isAuthenticated === true && api.hasSession();
  return useQuery({
    queryKey: ["me", api.getSession()],
    queryFn: () => api.getMe(),
    enabled: hasSession,
    staleTime: 60_000,
    retry: false,
  });
}

export function usePermissions() {
  const { isAuthenticated } = useAuth();
  const me = useMe();
  // The legacy tenant key has always had admin-level access (never billing).
  const legacy = isAuthenticated === true && !api.hasSession();
  const can = useCallback(
    (permission: Permission): boolean =>
      legacy ? permission !== "billing:manage" : Boolean(me.data?.permissions.includes(permission)),
    [legacy, me.data],
  );
  const role: Role | undefined = legacy ? "admin" : me.data?.workspace.role;
  return {
    can,
    role,
    legacy,
    user: me.data?.user,
    workspace: me.data?.workspace,
    isLoading: !legacy && me.isLoading,
  };
}
