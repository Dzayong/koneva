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
  turbopack: {
    // This app has its own package-lock.json but lives inside the
    // wa-gateway repo, which also has one — pin the root explicitly so
    // Turbopack doesn't have to guess between the two.
    root: path.join(__dirname),
  },
};

export default nextConfig;
