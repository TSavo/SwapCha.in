import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { CLAIM_ALLOWLIST, verifyClaimTx } from "../intel.js";
import {
  claimableNow,
  labels,
  REGISTRY,
  REGISTRY_ALLOWLIST,
  scanned,
  scanRegistry,
} from "./registry.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

describe("LegacyETH registry data", () => {
  it("lists every legacyeth.com contract once", () => {
    expect(REGISTRY.length).toBe(296);
    expect(new Set(REGISTRY.map((e) => e.address.toLowerCase())).size).toBe(296);
  });
  it("only confirmed DEX/Fomo3D entries are scanned, each with a claim", () => {
    const s = scanned();
    expect(s.length).toBe(43);
    for (const e of s) {
      expect(["etherdelta-dex", "fomo3d"]).toContain(e.family);
      expect(e.claim).toBe(e.family === "fomo3d" ? "withdraw()" : "withdraw(uint256)");
      expect(e.confirmedAtBlock).toBeGreaterThan(0);
    }
  });
  it("keeps dedicated coverage for existing contracts (no double scan)", () => {
    const keys = REGISTRY.filter((e) => e.status === "covered-elsewhere")
      .map((e) => e.key)
      .sort();
    expect(keys).toEqual(["ens_old", "etherdelta", "fomo3d_long", "idex", "powh3d", "thedao"]);
  });
  it("allowlist is merged and exact-selector", () => {
    for (const [a, sels] of Object.entries(REGISTRY_ALLOWLIST))
      expect(CLAIM_ALLOWLIST[a]).toEqual(sels);
    const e = scanned().find((x) => x.family === "etherdelta-dex")!;
    const to = e.address;
    expect(
      verifyClaimTx({ to, data: btSelector("withdraw(uint256)") + "00".repeat(32), value: "0" })
        .verified,
    ).toBe(true);
    expect(verifyClaimTx({ to, data: btSelector("withdraw()"), value: "0" }).verified).toBe(false);
    expect(
      verifyClaimTx({ to, data: btSelector("withdraw(uint256)") + "00".repeat(32), value: "1" })
        .verified,
    ).toBe(false);
  });
});

describe("gating and labels", () => {
  it("needs owed > 0, a passing simulation and enough ETH held", () => {
    expect(claimableNow(5n, 10n, true)).toBe(true);
    expect(claimableNow(5n, 4n, true)).toBe(false);
    expect(claimableNow(5n, 10n, false)).toBe(false);
    expect(claimableNow(0n, 10n, true)).toBe(false); // Fomo3D withdraw() passes on empty vaults
  });
  it("labels EOA-only, owner-gated, two-step and underfunded", () => {
    const e = {
      ...scanned().find((x) => x.family === "fomo3d")!,
      ownerGated: true,
      multiStep: true,
    };
    const l = labels(e, 10n, 1n).join(" | ");
    expect(l).toMatch(/EOA only/);
    expect(l).toMatch(/Owner action/);
    expect(l).toMatch(/Two steps/);
    expect(l).toMatch(/Underfunded/);
  });
});

describe("scanRegistry (mocked reads)", () => {
  const s = scanned();
  const dex = s.filter((e) => e.family === "etherdelta-dex");
  const fomo = s.filter((e) => e.family === "fomo3d");
  const mk = (opts: { simOk: boolean; held: bigint; fail?: boolean }) => {
    const calls: unknown[] = [];
    const c = {
      multicall: async (a: {
        contracts: { functionName: string; address: string }[];
        blockNumber?: bigint;
      }) => {
        calls.push(a.blockNumber);
        return a.contracts.map((x, i) => {
          if (opts.fail && i === 0) return { status: "failure", error: new Error("x") };
          if (x.functionName === "tokens")
            return {
              status: "success",
              result: x.address === dex[0]!.address ? 3n * 10n ** 18n : 0n,
            };
          if (x.functionName === "pIDxAddr_")
            return { status: "success", result: x.address === fomo[0]!.address ? 7n : 0n };
          return { status: "success", result: [1n, 2n, 0n] };
        });
      },
      getBalance: async () => opts.held,
      call: async () => {
        if (!opts.simOk) throw new Error("revert");
        return { data: "0x" };
      },
    };
    return { c: c as never, calls };
  };
  it("offers a tx only when confirmed, pinned to the block, with evidence", async () => {
    const { c, calls } = mk({ simOk: true, held: 10n ** 20n });
    const r = await scanRegistry(c, OWNER, 123n);
    expect(calls.every((b) => b === 123n)).toBe(true);
    expect(r.hits.length).toBe(2);
    const d = r.hits.find((h) => h.entry.family === "etherdelta-dex")!;
    expect(d.claimable).toBe(true);
    expect(d.tx!.data.startsWith(btSelector("withdraw(uint256)"))).toBe(true);
    expect(d.evidence[0]!.block).toBe("123");
    const f = r.hits.find((h) => h.entry.family === "fomo3d")!;
    expect(f.owedWei).toBe(3n);
    expect(f.tx!.data).toBe(btSelector("withdraw()"));
    expect(f.labels.join(" ")).toMatch(/EOA only/);
    expect(r.notChecked.some((l) => /not checked yet/.test(l))).toBe(true);
  });
  it("no tx when the simulation reverts or the contract is underfunded", async () => {
    for (const o of [
      { simOk: false, held: 10n ** 20n },
      { simOk: true, held: 1n },
    ]) {
      const r = await scanRegistry(mk(o).c, OWNER, 1n);
      for (const h of r.hits) {
        expect(h.claimable).toBe(false);
        expect(h.tx).toBeUndefined();
      }
    }
  });
  it("reports failed reads as not checked, never zero", async () => {
    const r = await scanRegistry(mk({ simOk: true, held: 1n, fail: true }).c, OWNER, 1n);
    expect(r.notChecked.join(" ")).toContain(`${dex[0]!.name}: not checked`);
  });
});
