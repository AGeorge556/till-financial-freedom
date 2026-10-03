import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Backup restore uploads up to 5 MB (app/actions/backup.ts); the default action body limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
