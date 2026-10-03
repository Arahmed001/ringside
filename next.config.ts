import type { NextConfig } from "next";
import { STATIC_HEADERS } from "./lib/security";

// Note: do NOT set `turbopack.root` here. Setting it coincided with the dev server hanging at
// "Compiling /" and exhausting the machine's process table (see PLAN.md, "Known issues").
const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false, // do not announce the framework on every response
  async headers() { return [{ source: "/:path*", headers: STATIC_HEADERS }]; },
};

export default nextConfig;
