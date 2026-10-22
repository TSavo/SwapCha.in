import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Docker: self-contained server in .next/standalone (traced from the monorepo root).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Type checking runs via `pnpm typecheck` (tsc 7); skip Next's built-in pass.
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@swapchan/shared"],
};

export default config;
