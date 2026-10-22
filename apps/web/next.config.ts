import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Type checking runs via `pnpm typecheck` (tsc 7); skip Next's built-in pass.
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@swapchan/shared"],
};

export default config;
