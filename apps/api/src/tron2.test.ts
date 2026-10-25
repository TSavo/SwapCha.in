import { describe, expect, it } from "vitest";
import { addrParam, STRX, tronExtras } from "./tron2.js";

const OWNER = "TVSVjZdG6ZcPfaV6bfRSqrgK5UqXyHFoXD";
const mk = (calls: string[]) =>
  (async (url: string) => {
    calls.push(String(url));
    const u = String(url);
    const body = u.includes("unfreezebalancev2")
      ? { txID: "ab", raw_data: {}, raw_data_hex: "00" }
      : u.includes("/v1/accounts")
        ? { data: [] }
        : {};
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
describe("tronExtras", () => {
  it("builds an unfreeze tx for Stake 2.0 frozen TRX", async () => {
    const calls: string[] = [];
    const r = await tronExtras(
      mk(calls),
      {} as never,
      OWNER,
      { frozenV2: [{ amount: 5_000_000 }, { type: "ENERGY", amount: 0 }] } as never,
      0.3,
      async () => undefined,
    );
    const it = r.find((x) => x.claimTx);
    expect(it?.valueUsd).toBeCloseTo(1.5);
    expect(calls.some((c) => c.includes("unfreezebalancev2"))).toBe(true);
  });
  it("encodes address params as 32-byte words", () => {
    expect(addrParam(STRX)).toHaveLength(64);
  });
});
