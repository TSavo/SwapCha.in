import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import {
  BASE_CLAIM_ALLOWLIST,
  CLAIM_ALLOWLIST,
  registryCollisions,
  verifyClaimTx,
} from "../intel.js";
import {
  claimableNow,
  labels,
  REGISTRY,
  REGISTRY_ALLOWLIST,
  refused,
  scanned,
  scanRegistry,
  validEntry,
} from "./registry.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

describe("LegacyETH registry data", () => {
  it("lists every legacyeth.com contract once", () => {
    expect(REGISTRY.length).toBe(296);
    expect(new Set(REGISTRY.map((e) => e.address.toLowerCase())).size).toBe(296);
  });
  it("only confirmed DEX/Fomo3D entries are scanned, each with a claim", () => {
    const s = scanned().filter((e) => ["etherdelta-dex", "fomo3d"].includes(e.family));
    expect(s.length).toBe(43);
    expect(scanned().length).toBe(79);
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
    const l = r.notChecked.join(" ");
    expect(l).toContain(dex[0]!.name);
    expect(l).toContain("not checked (read failed)");
  });
});

describe("review fixes", () => {
  it("failed balance read fails closed", () => {
    expect(claimableNow(5n, null, true)).toBe(false);
    expect(labels(scanned()[0]!, 5n, null).join(" ")).toMatch(/Balance read failed/);
  });
  it("claim selector is pinned per family; mismatching rows are refused", () => {
    const d = scanned().find((x) => x.family === "etherdelta-dex")!;
    const f = scanned().find((x) => x.family === "fomo3d")!;
    expect(validEntry({ ...d, claim: "withdraw()" })).toBe(false);
    expect(validEntry({ ...f, claim: "withdraw(uint256)" })).toBe(false);
    expect(validEntry({ ...d, claim: "transfer(address,uint256)" })).toBe(false);
    expect(refused()).toEqual([]);
    for (const e of scanned().filter((x) => ["etherdelta-dex", "fomo3d"].includes(x.family)))
      expect(REGISTRY_ALLOWLIST[e.address.toLowerCase()]).toEqual([
        btSelector(e.family === "fomo3d" ? "withdraw()" : "withdraw(uint256)"),
      ]);
  });
  it("registry never collides with curated allowlist or dedicated scanners", () => {
    expect(registryCollisions()).toEqual([]);
    const p3d = Object.keys(BASE_CLAIM_ALLOWLIST)[0]!;
    expect(registryCollisions(BASE_CLAIM_ALLOWLIST, { [p3d]: ["0x00000000"] })).toEqual([p3d]);
    const idex = REGISTRY.find((e) => e.key === "idex")!.address.toLowerCase();
    expect(registryCollisions(BASE_CLAIM_ALLOWLIST, { [idex]: ["0x00000000"] })).toEqual([idex]);
  });
  it("does not scan unpinned when the block number is unknown", async () => {
    let n = 0;
    const c = {
      multicall: async () => (n++, []),
      getBalance: async () => 0n,
      call: async () => ({}),
    };
    const r = await scanRegistry(c as never, OWNER, undefined);
    expect(n).toBe(0);
    expect(r.hits).toEqual([]);
    expect(r.notChecked.join(" ")).toMatch(/not checked \(could not read the current block\)/);
  });
  it("balance read failure is reported as not checked and no tx", async () => {
    const d = scanned().find((x) => x.family === "etherdelta-dex")!;
    const c = {
      multicall: async (a: { contracts: { functionName: string; address: string }[] }) =>
        a.contracts.map((x) => ({ status: "success", result: x.address === d.address ? 5n : 0n })),
      getBalance: async () => {
        throw new Error("rpc");
      },
      call: async () => ({ data: "0x" }),
    };
    const r = await scanRegistry(c as never, OWNER, 9n);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]!.tx).toBeUndefined();
    expect(r.notChecked.join(" ")).toContain(`${d.name}: not checked (balance read failed)`);
  });
});
