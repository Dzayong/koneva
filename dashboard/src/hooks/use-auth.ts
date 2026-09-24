"use client";

import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

function getServerSnapshot(): boolean {
  return false;
}

export function useAuth() {
  const router = useRouter();
  const isAuthenticated = useSyncExternalStore(
    (listener) => api.subscribeAuth(listener),
    () => api.isAuthenticated(),
    getServerSnapshot,
  );

  const login = useCallback(
    (apiKey: string) => {
      api.setApiKey(apiKey);
      router.push("/");
    },
    [router],
  );

  const logout = useCallback(() => {
    api.clearApiKey();
    router.push("/login");
  }, [router]);

  return { isAuthenticated, login, logout };
}
