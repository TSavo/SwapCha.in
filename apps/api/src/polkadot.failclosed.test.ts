import { describe, expect, it, vi } from "vitest";

// No TS fallback: with the blocktools WASM unavailable, Polkadot is reported "not checked" and nothing is fetched.
vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  const gone = () => {
    throw new Error("blocktools unavailable");
  };
  return {
    ...m,
    blocktools: () => null,
    btSs58Decode: gone,
    btDotStorageKey: gone,
    btDecodeAccountInfo: gone,
  };
});
const { dotScan } = await import("./ledgers2.js");

describe("Polkadot fails closed without blocktools", () => {
  it("not checked, no network", async () => {
    const f = vi.fn();
    const r = await dotScan(
      f as unknown as typeof fetch,
      "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB",
    );
    expect(r.items).toEqual([]);
    expect(r.notChecked).toEqual(["Polkadot: not checked (blocktools unavailable)"]);
    expect(f).not.toHaveBeenCalled();
  });
});
