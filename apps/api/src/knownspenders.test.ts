import { describe, it, expect } from "vitest";
import { knownSpenderAllowances, spendersFor, KNOWN_ONLY_NOTE } from "./knownspenders.js";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER = "0x00000000000000000000000000000000000000aa";
describe("knownSpenderAllowances", () => {
  it("reports only nonzero allowances against curated spenders", async () => {
    const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const c = { multicall: async ({ contracts }: { contracts: { args: [string, string] }[] }) =>
      contracts.map((x) => ({ status: "success", result: x.args[1] === permit2 ? 2n ** 255n : 0n })) } as never;
    const r = await knownSpenderAllowances(c, 8453, OWNER, [USDC]);
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe("Uniswap Permit2");
  });
  it("covers Base and BNB routers and says known spenders only", () => {
    expect(Object.values(spendersFor(8453))).toContain("Aerodrome Router");
    expect(Object.values(spendersFor(56))).toContain("PancakeSwap V2 Router");
    expect(KNOWN_ONLY_NOTE).toMatch(/known spenders only/);
  });
});
