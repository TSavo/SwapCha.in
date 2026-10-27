import { readFileSync } from "node:fs";
import { encodeFunctionData, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { dropRegistryDupes, registryAddressSet, simClaimAllowlisted } from "../intel.js";
import { BURN_SPECS } from "./burnrefund.js";
import { REGISTRY_APPROVALS, scanned, scanRegistry } from "./registry.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const APPROVE = parseAbiItem("function approve(address,uint256) returns (bool)");
const clone = () => scanned().find((e) => e.family === "hourglass")!;

describe("find_money: a registry contract is reported once", () => {
  it("drops chain-1 archaeology items whose claimTx.to is a scanned registry address", () => {
    const regs = registryAddressSet();
    expect(regs.size).toBe(149);
    const to = clone().address;
    const items = [
      {
        chainId: 1,
        protocol: "archaeology",
        claimTx: { to: to.toUpperCase().replace("0X", "0x") },
      },
      { chainId: 1, protocol: "archaeology", claimTx: { to: to.toLowerCase() } },
      { chainId: 10, protocol: "archaeology", claimTx: { to } },
      {
        chainId: 1,
        protocol: "other",
        claimTx: { to: "0x2222222222222222222222222222222222222222" },
      },
      { chainId: 1, protocol: "no tx" },
    ];
    const kept = dropRegistryDupes(items, regs);
    expect(kept.map((x) => x.protocol)).toEqual(["archaeology", "other", "no tx"]);
    expect(kept[0]!.chainId).toBe(10);
  });
  it("hourglass amount is myDividends(true) only: no token balance or sell-value read", async () => {
    const reads: { functionName: string; address: string }[] = [];
    const hg = new Set(
      scanned()
        .filter((e) => e.family === "hourglass")
        .map((e) => e.address.toLowerCase()),
    );
    const c = {
      multicall: async (a: { contracts: { functionName: string; address: string }[] }) => {
        reads.push(...a.contracts);
        return a.contracts.map(() => ({ status: "success", result: 0n }));
      },
      getBalance: async () => 10n ** 24n,
      call: async () => ({ data: "0x" }),
      request: async (a: { params: [{ blockStateCalls: [{ calls: unknown[] }] }] }) => [
        {
          calls: a.params[0].blockStateCalls[0].calls.map((_, i) => ({
            status: "0x1",
            returnData: `0x${(i === 0 ? 7n : 0n).toString(16).padStart(64, "0")}`,
          })),
        },
      ],
    };
    const r = await scanRegistry(c as never, OWNER, 9n);
    expect(reads.filter((x) => hg.has(String(x.address).toLowerCase()))).toEqual([]);
    const h = r.hits.find((x) => x.entry.key === clone().key)!;
    expect(h.owedWei).toBe(7n);
    expect(h.evidence.map((e) => e.call)).toEqual(["myDividends(bool)"]);
  });
});

describe("/simulate guard.claimAllowlisted for registry approvals", () => {
  const token = BURN_SPECS.digixdao!.token;
  const spender = REGISTRY_APPROVALS[token.toLowerCase()]! as `0x${string}`;
  const data = (amt: bigint) =>
    encodeFunctionData({ abi: [APPROVE], functionName: "approve", args: [spender, amt] });
  const client = (bal: bigint | Error) => ({
    calls: [] as unknown[],
    async readContract(a: never) {
      this.calls.push(a);
      if (bal instanceof Error) throw bal;
      return bal;
    },
  });
  it("reads balanceOf(from) and allows an approval up to it", async () => {
    const c = client(100n);
    expect(
      await simClaimAllowlisted(c, 1, OWNER, token.toLowerCase(), { data: data(100n), value: "0" }),
    ).toBe(true);
    expect((c.calls[0] as { functionName: string; args: string[] }).functionName).toBe("balanceOf");
    expect((c.calls[0] as { args: string[] }).args[0]!.toLowerCase()).toBe(OWNER);
    expect(
      await simClaimAllowlisted(client(99n), 1, OWNER, token.toLowerCase(), { data: data(100n) }),
    ).toBe(false);
  });
  it("fails closed when the balance read fails", async () => {
    expect(
      await simClaimAllowlisted(client(new Error("rpc down")), 1, OWNER, token.toLowerCase(), {
        data: data(1n),
      }),
    ).toBe(false);
  });
  it("non-approval claims and other chains are unchanged", async () => {
    const e = scanned().find((x) => x.family === "etherdelta-dex")!;
    const c = client(new Error("must not be read"));
    const d = btSelector("withdraw(uint256)") + "00".repeat(32);
    expect(
      await simClaimAllowlisted(c, 1, OWNER, e.address.toLowerCase(), { data: d, value: "0" }),
    ).toBe(true);
    expect(c.calls.length).toBe(0);
    expect(await simClaimAllowlisted(c, 10, OWNER, e.address.toLowerCase(), { data: d })).toBe(
      false,
    );
  });
});

describe("generator knows every scanned family", () => {
  it("SCANNED in scripts/gen-legacy-registry.py equals the families the scanner covers", () => {
    const py = readFileSync(
      new URL("../../../../scripts/gen-legacy-registry.py", import.meta.url),
      "utf8",
    );
    const block = /^SCANNED = \{([\s\S]*?)\}/m.exec(py)![1]!;
    const gen = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(gen).toEqual([...new Set(scanned().map((e) => e.family))].sort());
  });
});
