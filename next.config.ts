import type { NextConfig } from "next";

// Note: do NOT set `turbopack.root` here. Setting it coincided with the dev server hanging at
// "Compiling /" and exhausting the machine's process table (see PLAN.md, "Known issues").
const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
