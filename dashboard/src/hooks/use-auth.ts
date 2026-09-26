"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type { AuthResult } from "@/lib/types";

function getServerSnapshot(): boolean | null {
  // Local storage is unavailable during SSR. Preserve an unknown state until
  // hydration reads the client snapshot so AuthGuard cannot redirect a valid session.
  return null;
}

export function useAuth() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useSyncExternalStore(
    (listener) => api.subscribeAuth(listener),
    () => api.isAuthenticated(),
    getServerSnapshot,
  );

  /** Legacy sign-in with a tenant API key. */
  const login = useCallback(
    (apiKey: string) => {
      api.clearSession();
      api.setApiKey(apiKey);
      queryClient.clear();
      router.push("/dashboard");
    },
    [router, queryClient],
  );

  const loginWithSession = useCallback(
    (result: AuthResult, destination = "/dashboard") => {
      api.clearApiKey();
      api.setSession(result.token, result.workspaces[0]?.id);
      queryClient.clear();
      router.push(destination);
    },
    [router, queryClient],
  );

  const logout = useCallback(async () => {
    await api.logoutRemote();
    api.clearSession();
    api.clearApiKey();
    queryClient.clear();
    router.push("/login");
  }, [router, queryClient]);

  return { isAuthenticated, login, loginWithSession, logout };
}
