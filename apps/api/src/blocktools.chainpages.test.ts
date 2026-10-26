// Drift guard: @swapchan/shared CHAIN_PAGE_ROWS (/chains/<slug> pages) == chain-page-rows.cjs over the vendored wasm.
import { createRequire } from "node:module";
import { CHAIN_PAGE_ROWS, CHAIN_TABLE } from "@swapchan/shared";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const w = require("../vendor/blocktools/blocktools_wasm.js");
const { chainPageRows } = require("../scripts/chain-page-rows.cjs");

describe("chain pages (display metadata)", () => {
  it("shared CHAIN_PAGE_ROWS is current (regenerate with scripts/gen-chain-pages.cjs)", () => {
    expect(CHAIN_PAGE_ROWS).toEqual(chainPageRows(w));
    expect(CHAIN_PAGE_ROWS.map((r) => r.name)).toEqual(CHAIN_TABLE.map((r) => r.name));
  });
  it("every example address validates on its own chain", () => {
    for (const r of CHAIN_PAGE_ROWS)
      for (const e of r.examples) expect(w.addressValidate(r.name, e.address)).toBe(e.kind);
  });
});
