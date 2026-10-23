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
  // Only the widget (/embed) may be framed, by anyone. Everything else is non-frameable.
  // Deep links: /swap?fromChain=…&toToken=… (and /swap/batch?items=…) land on the swap card.
  async redirects() {
    return [
      ...["fromChain", "fromToken", "toChain", "toToken", "amount"].map((key) => ({
        source: "/swap",
        has: [{ type: "query" as const, key }],
        destination: "/",
        permanent: false,
      })),
      { source: "/swap/batch", destination: "/batch", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/embed",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        source: "/((?!embed$).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/widget.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
    ];
  },
};

export default config;
