import { DOGECOIN, LITECOIN, NON_EVM } from "@swapchan/shared";
import { describe, expect, it, vi } from "vitest";

// No WASM: no PSBT is built and the guard refuses; there is no TypeScript fallback.
vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  const need = () => {
    throw new Error("blocktools unavailable");
  };
  return { ...m, blocktools: () => null, btBuildPsbt: need, btVerifyThorSend: need };
});

const TAKER = "ltc1qe2tczyk2rw7u47kzxxee5g7ufkncdmlc9854ex";
const VAULT = "ltc1q8c37s9sq89v55vuffajkfcd3xj9m67sq3r2zcjktw0h2a4vuqzws4u8fax";
const DOGE_TO = "D8XhvXbJYovhJN7X51qkrYACDX29vBamQF";

describe("LTC/DOGE/BCH send fails closed without blocktools", () => {
  it("buildUtxoSend refuses before any network call", async () => {
    const { buildUtxoSend } = await import("./utxosend.js");
    const f = vi.fn();
    await expect(
      buildUtxoSend(f as unknown as typeof fetch, {} as NodeJS.ProcessEnv, {
        chainId: LITECOIN,
        taker: TAKER,
        vault: VAULT,
        amount: 10_000_000n,
        memo: `=:d:${DOGE_TO}:1`,
        feeRate: 2,
      }),
    ).rejects.toThrow(/blocktools is unavailable/);
    expect(f).not.toHaveBeenCalled();
  });
  it("the guard refuses with reason blocktools", async () => {
    const { verifyPayload } = await import("./guard/index.js");
    const v = await verifyPayload(
      {
        provider: "thorchain",
        req: {
          fromChainId: LITECOIN,
          fromToken: NON_EVM[LITECOIN]!.native,
          toChainId: DOGECOIN,
          toToken: NON_EVM[DOGECOIN]!.native,
          amount: "10000000",
          slippageBps: 100,
          taker: TAKER,
          recipient: DOGE_TO,
        },
        toAmount: "1",
        nonEvmTx: {
          vm: "uvm",
          kind: "uvm-psbt",
          data: { psbt: "cHNidP8=", summary: { memo: `=:d:${DOGE_TO}:1` } },
        },
      } as never,
      {
        thorInbound: async () => [{ chain: "LTC", address: VAULT, router: "" }],
        relay: async () => ({ contracts: [], solvers: [] }),
        zeroxSettlers: async () => [],
      } as never,
    );
    expect(v.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["blocktools"]);
  });
});
