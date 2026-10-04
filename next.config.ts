import type { NextConfig } from "next";

// No script CSP on purpose: Next's inline scripts (and the privacy boot script) would need a per-request nonce, which makes
// every page dynamic. These headers need no nonce, so they cannot break a page.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // One year, this host only: includeSubDomains/preload would also bind every other subdomain of a custom domain.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Backup restore uploads up to 5 MB (app/actions/backup.ts); the default action body limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
