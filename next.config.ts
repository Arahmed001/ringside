import type { NextConfig } from "next";
import { EMBED_HEADERS, STATIC_HEADERS } from "./lib/security";

// Note: do NOT set `turbopack.root` here. Setting it coincided with the dev server hanging at
// "Compiling /" and exhausting the machine's process table (see PLAN.md, "Known issues").
const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false, // do not announce the framework on every response
  // every path but /embed refuses to be framed; the embeds (made for other sites to frame) carry the same headers without X-Frame-Options (lib/security.ts)
  async headers() { return [{ source: "/embed/:path*", headers: EMBED_HEADERS }, { source: "/((?!embed/).*)", headers: STATIC_HEADERS }]; },
};

export default nextConfig;
