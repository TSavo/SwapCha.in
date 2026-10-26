// Regenerates packages/shared/src/chainPages.json (public format facts for the /chains/<slug> pages) from the vendored
// blocktools wasm: chainParams() rows plus example addresses that addressValidate() accepts. Display metadata only.
// Run: node apps/api/scripts/gen-chain-pages.cjs   (blocktools.chainpages.test.ts fails when the file is stale)
const fs = require("node:fs");
const path = require("node:path");
const w = require("../vendor/blocktools/blocktools_wasm.js");
const { chainPageRows } = require("./chain-page-rows.cjs");
const out = path.join(__dirname, "../../../packages/shared/src/chainPages.json");
fs.writeFileSync(out, `${JSON.stringify(chainPageRows(w), null, 2)}\n`);
console.log(`wrote ${out}`);
// match the repo formatter so `biome check` stays clean (best effort: skipped if biome is not installed)
try {
  require("node:child_process").execFileSync("pnpm", ["exec", "biome", "format", "--write", out], {
    cwd: path.join(__dirname, "../../.."),
    stdio: "ignore",
  });
} catch {}
