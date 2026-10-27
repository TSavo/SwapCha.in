import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

const LP = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc"; // lowercase from RPC
const OWNER = "0x00000000219ab540356cBB839Cbe05303d7705Fa";
const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);

vi.mock("./onchain.js", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    evmClient: () => ({
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "getUserNumLockedTokens":
          case "getUserNumLocksForToken":
            return 1n;
          case "getUserLockedTokenAtIndex":
            return LP;
          case "getUserLockForTokenAtIndex":
            return [1n, 10n ** 18n, 10n ** 18n, FUTURE, 7n, OWNER];
          case "symbol":
            return "UNI-V2";
          case "decimals":
            return 18;
          default:
            throw new Error(functionName);
        }
      },
      call: async () => ({}),
    }),
  };
});

const { uncxLocks } = await import("./locks.js");
const { btcXpubScan } = await import("./stuck.js");

describe("full addresses in lock and UTXO outputs", () => {
  it("UNCX LP lock shows the full checksummed LP address", async () => {
    const r = await uncxLocks(fetch, {}, OWNER);
    expect(r).toHaveLength(1);
    expect(r[0]!.what).toContain(`LP ${getAddress(LP)} locked until`);
    expect(r[0]!.what).not.toContain("…");
  });
  it("Bitcoin UTXO scan shows the full address", async () => {
    const ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    const f = (async (url: string | URL) => {
      const u = String(url);
      const body = u.includes("mempool.space")
        ? { chain_stats: { funded_txo_sum: 150000, spent_txo_sum: 50000 } }
        : {};
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const r = await btcXpubScan(f, ADDR);
    expect(r).toHaveLength(1);
    expect(r[0]!.what).toBe(`0.001 BTC across UTXOs at ${ADDR}`);
  });
});
