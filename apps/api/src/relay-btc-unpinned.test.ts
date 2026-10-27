import { describe, expect, it, vi } from "vitest";
import { fanOut } from "./aggregate.js";
import type { GuardCtx } from "./guard/ctx.js";
import type { ProviderAdapter } from "./providers/types.js";

// Bitcoin (8253038) is deliberately NOT pinned for Relay (sources disagreed on 2026-10-26).
const BTC = 8253038;
const req = {
  fromChainId: BTC,
  toChainId: 1,
  fromToken: "bitcoin",
  toToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  amount: "100000",
  slippageBps: 50,
} as never;
const quote = (provider: string) =>
  ({
    id: `${provider}-1`,
    provider,
    request: req,
    toAmount: "1000",
    netUsd: null,
    approvalAddress: null,
    tx: null,
  }) as never;
const adapter = (name: string): ProviderAdapter =>
  ({
    name,
    enabled: () => true,
    supports: () => true,
    quote: async () => quote(name),
  }) as never;

describe("Bitcoin routes with Relay fail-closed on unpinned chains", () => {
  it("drops only the Relay BTC route with RELAY_CHAIN_NOT_PINNED; THORChain and LI.FI unchanged", async () => {
    const relayProtocol = vi.fn();
    const relay = vi.fn();
    const guard = {
      thorInbound: async () => [],
      relay,
      zeroxSettlers: async () => [],
      relayProtocol,
    } as unknown as GuardCtx;
    const r = await fanOut(
      [adapter("thorchain"), adapter("lifi"), adapter("relay")],
      req,
      8000,
      0,
      null,
      guard,
    );
    expect(r.quotes.map((q) => q.provider).sort()).toEqual(["lifi", "thorchain"]);
    expect(r.best).not.toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.provider).toBe("relay");
    expect(r.errors[0]?.message).toMatch(/RELAY_CHAIN_NOT_PINNED: chain 8253038/);
    // No Relay /chains lookups on the refused path.
    expect(relayProtocol).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
  });
});
