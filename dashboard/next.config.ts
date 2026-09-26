import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return process.env.INTERNAL_API_URL ? [
      { source: "/api/v1/:path*", destination: `${process.env.INTERNAL_API_URL}/api/v1/:path*` },
      { source: "/auth/:path*", destination: `${process.env.INTERNAL_API_URL}/auth/:path*` },
      { source: "/public/:path*", destination: `${process.env.INTERNAL_API_URL}/public/:path*` },
    ] : [];
  },
  async redirects() {
    // The landing page now lives at "/"; keep old links and bookmarks working.
    return [{ source: "/welcome", destination: "/", permanent: true }];
  },
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
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
