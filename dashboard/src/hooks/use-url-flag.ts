import { useSyncExternalStore } from "react";

const noop = () => () => undefined;

/** True when the current URL has `?name=value`. Read from the browser; false during server render. */
export function useUrlFlag(name: string, value = "1"): boolean {
  return useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get(name) === value,
    () => false,
  );
}

/** A boolean kept in localStorage (false when storage is unavailable). */
export function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
