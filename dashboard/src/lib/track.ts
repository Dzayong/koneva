/**
 * First-party, cookie-free visit counter. It sends only the event name, the referrer's host and the
 * utm_source; no identifier, no IP is stored, so no consent banner is needed. Failures are ignored.
 */
export type SiteEvent = "view" | "cta_signup" | "cta_login" | "view_docs";

export function track(event: SiteEvent): void {
  try {
    if (event === "view" || event === "view_docs") {
      const key = `wg_seen_${event}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    }
    let ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch { /* malformed referrer */ }
    if (ref === window.location.hostname) ref = "";
    const utm = new URLSearchParams(window.location.search).get("utm_source") ?? "";
    void fetch("/public/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, ref: ref.slice(0, 80), utm: utm.slice(0, 40) }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* storage or network unavailable: counting is best-effort */
  }
}
