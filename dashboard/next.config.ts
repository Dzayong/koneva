import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Test runs use their own build directory so they can run next to a developer's own `next dev` (see playwright.stack.config.ts).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  output: "standalone",
  // The default 30 s proxy limit turned slow-but-valid API calls (asking a number for its catalog) into a bare 500.
  experimental: { proxyTimeout: 70_000 },
  async rewrites() {
    return process.env.INTERNAL_API_URL ? [
      { source: "/api/v1/:path*", destination: `${process.env.INTERNAL_API_URL}/api/v1/:path*` },
      { source: "/auth/:path*", destination: `${process.env.INTERNAL_API_URL}/auth/:path*` },
      { source: "/public/:path*", destination: `${process.env.INTERNAL_API_URL}/public/:path*` },
      // Operator API (PROPOSED contract): the browser only ever sees /api/operator/*, never /admin and never the admin key.
      { source: "/api/operator/:path*", destination: `${process.env.INTERNAL_API_URL}/operator/:path*` },
    ] : [];
  },
  async redirects() {
    // The landing page now lives at "/"; keep old links and bookmarks working.
    return [{ source: "/welcome", destination: "/", permanent: true }];
  },
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    // Operator pages and API answers carry personal and financial data: never cached or shared, never framed.
    const operator = [
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      ...noindex,
    ];
    return [
      { source: "/operator", headers: operator },
      { source: "/operator/:path*", headers: operator },
      { source: "/api/operator/:path*", headers: operator },
      { source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
      ...["dashboard", "devices", "messages", "broadcast", "contacts", "analytics", "settings", "developers", "team", "activity", "billing", "invite", "login", "signup"]
        .map((p) => ({ source: `/${p}/:path*`, headers: noindex })),
      ...["dashboard", "devices", "messages", "broadcast", "contacts", "analytics", "settings", "developers", "team", "activity", "billing", "login", "signup"]
        .map((p) => ({ source: `/${p}`, headers: noindex })),
    ];
  },
  turbopack: {
    // This app has its own package-lock.json but lives inside the
    // wa-gateway repo, which also has one — pin the root explicitly so
    // Turbopack doesn't have to guess between the two.
    root: path.join(__dirname),
  },
};

export default nextConfig;
