/**
 * Server-only. This module reads `process.env` directly and must never be imported from a "use client"
 * component or a module that a Client Component imports — importing it there would let Next.js try to bundle
 * `process.env.KONEVA_SANDBOX` into client JS, which only works via the `NEXT_PUBLIC_` prefix convention this
 * deliberately avoids (see dashboard/src/components/dev-banner.tsx for why: a `NEXT_PUBLIC_` value gets frozen
 * into the JS bundle at `next build` time, so a single build artifact reused by both the :13000 and :13200
 * processes would show the same value on both, regardless of which port actually served the request).
 *
 * Callers in a Server Component should read this after `await connection()` (from "next/server") so the value
 * is resolved per-request at runtime, not folded into a static prerender.
 */
export function isSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["KONEVA_SANDBOX"] === "1";
}
