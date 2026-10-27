import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { registryCollisions, verifyClaimTx } from "../intel.js";
import {
  labels,
  REGISTRY,
  REGISTRY_ALLOWLIST,
  scanned,
  scanRegistry,
  validEntry,
} from "./registry.js";
import {
  SIM_CONCURRENCY,
  SIM_SPECS,
  scanSimClaim,
  tracedPayout,
  validSimClaim,
} from "./simclaim.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TT = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const w = (a: string) => `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
const pr5 = () => scanned().filter((e) => e.confirmedAtBlock === 26280699);
const hong = () => REGISTRY.find((e) => e.key === "hong")!;
const eth = (from: string, to: string, v: bigint) => ({
  address: NATIVE,
  topics: [TT, w(from), w(to)],
  data: `0x${v.toString(16).padStart(64, "0")}`,
});

describe("LegacyETH PR 5", () => {
  it("21 rows confirmed at block 26280699; counts", () => {
    const n: Record<string, number> = {};
    for (const e of pr5()) n[e.family] = (n[e.family] ?? 0) + 1;
    expect(n).toEqual({ "sim-claim": 19, "ethfinex-wrapper": 2 });
    expect(scanned().length).toBe(178);
    expect(REGISTRY.filter((e) => e.status === "not-checked").length).toBe(112);
    expect(registryCollisions()).toEqual([]);
  });
  it("sim-claim rows are pinned in code: key, address and selector", () => {
    for (const e of pr5().filter((x) => x.family === "sim-claim")) {
      const s = SIM_SPECS[e.key]!;
      expect(s.address).toBe(e.address.toLowerCase());
      expect(REGISTRY_ALLOWLIST[s.address]).toEqual([btSelector(s.claim)]);
      expect(validSimClaim({ ...e, claim: "transfer(address,uint256)" })).toBe(false);
      expect(validSimClaim({ ...e, address: OWNER })).toBe(false);
      expect(validSimClaim({ ...e, key: "nope" })).toBe(false);
    }
    expect(Object.keys(SIM_SPECS).length).toBe(27);
  });
  it("tracedPayout: only native ETH contract -> owner; a token leaving the owner fails closed", () => {
    const c = hong().address;
    expect(
      tracedPayout({ status: "0x1", logs: [eth(c, OWNER, 5n), eth(c, "0x22", 7n)] }, c, OWNER),
    ).toBe(5n);
    expect(tracedPayout({ status: "0x1", logs: [eth("0x33", OWNER, 5n)] }, c, OWNER)).toBe(0n);
    const tok = { address: "0x44", topics: [TT, w(OWNER), w(c)], data: w("1") };
    expect(tracedPayout({ status: "0x1", logs: [eth(c, OWNER, 5n), tok] }, c, OWNER)).toBeNull();
    expect(tracedPayout({ status: "0x0", logs: [] }, c, OWNER)).toBeNull();
    expect(tracedPayout(undefined, c, OWNER)).toBeNull();
  });
  const mk = (o: {
    pay?: bigint;
    mode?: "none" | "error" | "short" | "revert" | "token";
    held?: bigint | null;
  }) => {
    const es = scanned().filter(validSimClaim);
    return {
      getBalance: async () => {
        if (o.held === null) throw new Error("x");
        return o.held ?? 10n ** 24n;
      },
      ...(o.mode === "none"
        ? {}
        : {
            request: async (a: {
              params: [{ blockStateCalls: { calls: { to: string }[] }[] }];
            }) => {
              if (o.mode === "error") throw new Error("rpc");
              const b = a.params[0].blockStateCalls;
              if (o.mode === "short")
                return b.slice(1).map(() => ({ calls: [{ status: "0x1", logs: [] }] }));
              return b.map(({ calls: [x] }) => {
                const isHong = x!.to === hong().address.toLowerCase();
                if (!isHong) return { calls: [{ status: "0x0", logs: [] }] };
                if (o.mode === "revert") return { calls: [{ status: "0x0", logs: [] }] };
                const logs = [eth(x!.to, OWNER, o.pay ?? 0n)];
                if (o.mode === "token")
                  logs.push({ address: "0x44", topics: [TT, w(OWNER), w(x!.to)], data: w("1") });
                return { calls: [{ status: "0x1", logs }] };
              });
            },
          }),
      es,
    };
  };
  it("amount comes from the simulated claim; tx is the pinned selector, allowlisted", async () => {
    const m = mk({ pay: 3n * 10n ** 18n });
    const r = await scanSimClaim(m as never, OWNER, 9n, m.es);
    expect(r.failed).toEqual([]);
    expect(r.hits.length).toBe(1);
    const h = r.hits[0]!;
    expect(h.owedWei).toBe(3n * 10n ** 18n);
    expect(h.claimable).toBe(true);
    expect(h.tx!.data).toBe(btSelector("refundMyIcoInvestment()"));
    expect(h.tx!.value).toBe("0");
    expect(h.evidence[0]!.block).toBe("9");
    expect(verifyClaimTx(h.tx!).verified).toBe(true);
    expect(labels(hong(), 1n, 2n).join(" ")).toMatch(/Refund/);
  });
  it("fails closed: no simulateV1, RPC error, short result, token out -> not checked, never zero", async () => {
    for (const mode of ["none", "error", "short"] as const) {
      const m = mk({ mode });
      const r = await scanSimClaim(m as never, OWNER, 9n, m.es);
      expect(r.hits).toEqual([]);
      expect(r.failed.length).toBe(m.es.length);
    }
    const t = mk({ mode: "token", pay: 5n });
    const rt = await scanSimClaim(t as never, OWNER, 9n, t.es);
    expect(rt.hits).toEqual([]);
    expect(rt.failed).toEqual([hong().name]);
    const rv = mk({ mode: "revert" });
    expect((await scanSimClaim(rv as never, OWNER, 9n, rv.es)).hits).toEqual([]);
  });
  it("underfunded or unread balance builds no tx", async () => {
    for (const held of [1n, null]) {
      const m = mk({ pay: 5n, held });
      const h = (await scanSimClaim(m as never, OWNER, 9n, m.es)).hits[0]!;
      expect(h.claimable).toBe(false);
      expect(h.tx).toBeUndefined();
    }
  });
  it("isolation: one eth_simulateV1 request per contract, one call each, bounded concurrency", async () => {
    const es = scanned().filter(validSimClaim);
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    const m = {
      getBalance: async () => 10n ** 24n,
      request: async (a: { params: [{ blockStateCalls: { calls: { to: string }[] }[] }] }) => {
        const b = a.params[0].blockStateCalls;
        seen.push(b.length, b[0]!.calls.length);
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live--;
        const to = b[0]!.calls[0]!.to;
        if (to === es[0]!.address.toLowerCase()) throw new Error("odd");
        if (to === hong().address.toLowerCase())
          return [{ calls: [{ status: "0x1", logs: [eth(to, OWNER, 4n)] }] }];
        return [{ calls: [{ status: "0x0", logs: [] }] }];
      },
    };
    const r = await scanSimClaim(m as never, OWNER, 9n, es);
    expect(seen.length).toBe(es.length * 2);
    expect(seen.every((n) => n === 1)).toBe(true);
    expect(peak).toBeLessThanOrEqual(SIM_CONCURRENCY);
    if (es[0]!.key !== hong().key) {
      expect(r.failed).toEqual([es[0]!.name]);
      expect(r.hits.map((h) => h.owedWei)).toEqual([4n]);
    }
    expect(labels(hong(), 4n, null)).toContain("Contract balance not verified, no claim offered");
  });
  it("ethfinex-wrapper: balanceOf then withdraw(amount,0,0,0,0), allowlisted", async () => {
    const e = REGISTRY.find((x) => x.key === "ethfinex")!;
    expect(validEntry(e)).toBe(true);
    const c = {
      multicall: async (a: { contracts: { address: string }[] }) =>
        a.contracts.map((x) => ({ status: "success", result: x.address === e.address ? 7n : 0n })),
      getBalance: async () => 10n ** 24n,
      call: async () => ({ data: "0x" }),
      request: async () => {
        throw new Error("no");
      },
    };
    const r = await scanRegistry(c as never, OWNER, 9n);
    const h = r.hits.find((x) => x.entry.key === "ethfinex")!;
    const sel = btSelector("withdraw(uint256,uint8,bytes32,bytes32,uint256)");
    expect(h.tx!.data).toBe(`${sel}${"7".padStart(64, "0")}${"0".repeat(256)}`);
    expect(verifyClaimTx(h.tx!).verified).toBe(true);
    expect(r.notChecked.join(" ")).toMatch(/HONG/);
  });
});
