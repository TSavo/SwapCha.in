// Drift guard: displayed chain list/counts (@swapchan/shared CHAIN_TABLE) == blocktools chainTable() + zec (listChains()).
import { createRequire } from "node:module";
import { CHAIN_COUNT, CHAIN_TABLE, UTXO_CHAIN_COUNT } from "@swapchan/shared";
import { describe, expect, it } from "vitest";
import { runDevTool } from "./devtools.js";

const require = createRequire(import.meta.url);
const w = require("../vendor/blocktools/blocktools_wasm.js");
const { chainTableRows } = require("../scripts/chain-table-rows.cjs");

describe("chain table (display metadata)", () => {
  const table = JSON.parse(w.chainTable()) as { name: string }[];
  const list = JSON.parse(w.listChains()) as string[];
  it("shared CHAIN_TABLE is exactly chainTable() + zec (regenerate with scripts/gen-chain-table.cjs)", () => {
    expect(CHAIN_TABLE).toEqual(chainTableRows(w));
    expect(table.some((r) => r.name === "zec")).toBe(false);
    expect(CHAIN_TABLE.map((r) => r.name)).toEqual(list);
  });
  it("displayed count equals the table length + zec", () => {
    expect(CHAIN_COUNT).toBe(table.length + 1);
    expect(CHAIN_COUNT).toBe(list.length);
    const r = runDevTool("chain-params", {});
    expect(r.ok && (r.result as { count: number }).count).toBe(CHAIN_COUNT);
    const rows = JSON.parse(w.chainParams()) as { p2pkh: number[] | null }[];
    expect(UTXO_CHAIN_COUNT).toBe(rows.filter((x) => (x.p2pkh?.length ?? 0) > 0).length);
  });
});
