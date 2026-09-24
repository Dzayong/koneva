import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // This app has its own package-lock.json but lives inside the
    // wa-gateway repo, which also has one — pin the root explicitly so
    // Turbopack doesn't have to guess between the two.
    root: path.join(__dirname),
  },
};

export default nextConfig;
