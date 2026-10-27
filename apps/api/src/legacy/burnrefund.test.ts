import { encodeFunctionData, maxUint256, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { registryCollisions, verifyClaimTx } from "../intel.js";
import {
  BURN_SPECS,
  burnOwed,
  REFUND_CLAIM,
  REFUND_VIEWS,
  scanBurnRefund,
  validBurnRefund,
  verifyApproval,
} from "./burnrefund.js";
import {
  REGISTRY,
  REGISTRY_ALLOWLIST,
  REGISTRY_APPROVALS,
  scanned,
  scanRegistry,
} from "./registry.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PR1_3 = [
  "etherdelta-dex",
  "fomo3d",
  "weth-wrapper",
  "ether-balances",
  "presale-safe-withdrawal",
  "hourglass",
];
const pr2 = () =>
  scanned().filter((e) => !PR1_3.includes(e.family) && e.confirmedAtBlock === 26280214);
const by = (k: string) => REGISTRY.find((e) => e.key === k)!;
const APPROVE = parseAbiItem("function approve(address,uint256) returns (bool)");

describe("PR 2 families: data", () => {
  it("36 confirmed rows, counted by family (measured at block 26280214)", () => {
    const n: Record<string, number> = {};
    for (const e of pr2()) n[e.family] = (n[e.family] ?? 0) + 1;
    expect(n).toEqual({
      "refund-claim": 18,
      "refund-crowdsale": 11,
      "presale-pool": 2,
      "presale-withdraw": 1,
      "burn-token-for-eth": 4,
    });
    expect(REGISTRY.filter((e) => e.status === "not-checked").length).toBe(114);
    for (const e of pr2()) expect(e.confirmedAtBlock).toBe(26280214);
  });
  it("claim selector and views are pinned in code; mismatches are refused", () => {
    for (const e of pr2()) {
      if (e.family === "burn-token-for-eth") expect(e.claim).toBe(BURN_SPECS[e.key]!.claim);
      else {
        expect(e.claim).toBe(REFUND_CLAIM[e.family]);
        expect(REFUND_VIEWS.has(e.view!)).toBe(true);
      }
    }
    const r = pr2().find((e) => e.family === "refund-claim")!;
    expect(validBurnRefund({ ...r, claim: "refund()" })).toBe(false);
    expect(validBurnRefund({ ...r, view: "owner()" })).toBe(false);
    expect(validBurnRefund({ ...r, vault: undefined })).toBe(false);
    expect(validBurnRefund({ ...by("digixdao"), claim: "transfer(address,uint256)" })).toBe(false);
    expect(validBurnRefund({ ...by("digixdao"), key: "unknown" })).toBe(false);
    expect(validBurnRefund({ ...by("hong") })).toBe(false); // not confirmed
  });
  it("allowlist: exact claim contract + selector; approvals only to the pinned redemption contract", () => {
    const acid = BURN_SPECS.digixdao!.claimTo.toLowerCase();
    expect(REGISTRY_ALLOWLIST[acid]).toEqual([btSelector("burn()")]);
    expect(REGISTRY_APPROVALS[BURN_SPECS.digixdao!.token.toLowerCase()]).toBe(acid);
    expect(REGISTRY_APPROVALS[BURN_SPECS.delphi_redemption!.token.toLowerCase()]).toBe(
      BURN_SPECS.delphi_redemption!.claimTo.toLowerCase(),
    );
    expect(Object.keys(REGISTRY_APPROVALS).length).toBe(2);
    expect(registryCollisions()).toEqual([]);
    const dgd = BURN_SPECS.digixdao!.token;
    const ap = (sp: `0x${string}`, amt: bigint) =>
      encodeFunctionData({ abi: [APPROVE], functionName: "approve", args: [sp, amt] });
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, 5n), value: "0" }, 10n).verified,
    ).toBe(true);
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, maxUint256), value: "0" }, 10n)
        .verified,
    ).toBe(false);
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, 0n), value: "0" }, 10n).verified,
    ).toBe(false);
    expect(verifyClaimTx({ to: dgd, data: ap(OWNER, 5n), value: "0" }, 10n).verified).toBe(false);
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, 5n), value: "1" }, 10n).verified,
    ).toBe(false);
    expect(
      verifyApproval(
        REGISTRY_APPROVALS,
        {
          to: OWNER,
          data: ap(acid as `0x${string}`, 5n),
          value: "0",
        },
        10n,
      ),
    ).toBe(false);
    // no balance known: fail closed
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, 5n), value: "0" }).verified,
    ).toBe(false);
    // approval amount above the owner's on-chain balance at the pinned block
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, 11n), value: "0" }, 10n).verified,
    ).toBe(false);
    expect(
      verifyClaimTx({ to: dgd, data: ap(acid as `0x${string}`, 10n), value: "0" }, 10n).verified,
    ).toBe(true);
    // spender word with dirty top 12 bytes (same low 20 bytes as the pinned spender)
    const good = ap(acid as `0x${string}`, 5n);
    const dirty = `${good.slice(0, 10)}${"00".repeat(11)}01${good.slice(34)}`;
    expect(dirty.length).toBe(good.length);
    expect(verifyApproval(REGISTRY_APPROVALS, { to: dgd, data: dirty, value: "0" }, 10n)).toBe(
      false,
    );
    expect(verifyApproval(REGISTRY_APPROVALS, { to: dgd, data: good, value: "0" }, 10n)).toBe(true);
    const v = pr2().find((e) => e.family === "refund-claim")!;
    expect(
      verifyClaimTx({ to: v.address, data: btSelector("claimRefund()"), value: "0" }).verified,
    ).toBe(true);
    expect(
      verifyClaimTx({ to: v.vault!, data: btSelector("claimRefund()"), value: "0" }).verified,
    ).toBe(false);
  });
  it("owed amounts come from the on-chain rate", () => {
    expect(burnOwed(BURN_SPECS.digixdao!, 9992152664310n, 193054178n)).toBe(
      1929026819058876987180n,
    );
    expect(burnOwed(BURN_SPECS.delphi_redemption!, 322952n * 10n ** 18n, 2410n)).toBe(
      134004979253112033195n,
    );
    expect(burnOwed(BURN_SPECS.quantfury_qdt!, 10668979849728n, 4715436n)).toBe(
      50308891666682001408n,
    );
    expect(burnOwed(BURN_SPECS.aave_v1!, 7n, null)).toBe(7n);
    expect(burnOwed(BURN_SPECS.digixdao!, 1n, null)).toBeNull(); // failed rate read fails closed
  });
});

type MC = {
  contracts: { address: string; functionName: string; args?: unknown[] }[];
  blockNumber?: bigint;
};
function client(o: {
  owe?: Record<string, bigint>;
  vaultOverride?: string;
  allowance?: bigint;
  simOk?: boolean;
  held?: bigint | null;
  failFn?: string;
  noRequest?: boolean;
}) {
  const blocks: unknown[] = [];
  const sims: unknown[] = [];
  const c = {
    multicall: async (a: MC) => {
      blocks.push(a.blockNumber);
      return a.contracts.map((x) => {
        if (x.functionName === o.failFn) return { status: "failure", error: new Error("x") };
        const e = REGISTRY.find(
          (r) =>
            r.address.toLowerCase() === x.address.toLowerCase() ||
            r.vault?.toLowerCase() === x.address.toLowerCase(),
        );
        if (x.functionName === "vault")
          return { status: "success", result: o.vaultOverride ?? e?.vault };
        if (x.functionName === "allowance") return { status: "success", result: o.allowance ?? 0n };
        if (["weiPerNanoDGD", "exchangeRate", "getPrice"].includes(x.functionName))
          return { status: "success", result: 2n };
        const k = Object.entries(BURN_SPECS).find(
          ([, s]) => s.token.toLowerCase() === x.address.toLowerCase(),
        )?.[0];
        return { status: "success", result: o.owe?.[k ?? e?.key ?? ""] ?? 0n };
      });
    },
    getBalance: async () => {
      if (o.held === null) throw new Error("rpc");
      return o.held ?? 10n ** 24n;
    },
    call: async () => {
      if (o.simOk === false) throw new Error("revert");
      return { data: "0x" };
    },
    ...(o.noRequest
      ? {}
      : {
          request: async (a: { params: [{ blockStateCalls: [{ calls: unknown[] }] }, string] }) => {
            sims.push(a);
            const n = a.params[0].blockStateCalls[0].calls.length;
            return [
              {
                calls: Array.from({ length: n }, () => ({
                  status: o.simOk === false ? "0x0" : "0x1",
                })),
              },
            ];
          },
        }),
  };
  return { c: c as never, blocks, sims };
}

describe("scanBurnRefund (mocked reads)", () => {
  const vaultRow = pr2().find((e) => e.family === "refund-claim" && e.viewOn === "vault")!;
  it("refund: tx only with owed > 0, pinned block, evidence, claim to the crowdsale", async () => {
    const { c, blocks } = client({ owe: { [vaultRow.key]: 3n * 10n ** 17n } });
    const r = await scanBurnRefund(c, OWNER, 77n, pr2());
    expect(blocks.every((b) => b === 77n)).toBe(true);
    expect(r.hits.length).toBe(1);
    const h = r.hits[0]!;
    expect(h.claimable).toBe(true);
    expect(h.tx).toMatchObject({
      to: vaultRow.address,
      data: btSelector("claimRefund()"),
      value: "0",
    });
    expect(h.evidence.some((e) => e.call === "deposited(address)" && e.block === "77")).toBe(true);
    expect(verifyClaimTx(h.tx!).verified).toBe(true);
  });
  it("refund: vault changed -> not checked; underfunded or reverting -> no tx", async () => {
    let r = await scanBurnRefund(
      client({ owe: { [vaultRow.key]: 5n }, vaultOverride: OWNER }).c,
      OWNER,
      1n,
      pr2(),
    );
    expect(r.hits).toEqual([]);
    expect(r.failed).toContain(vaultRow.name);
    for (const o of [{ held: 1n }, { simOk: false }, { held: null }]) {
      r = await scanBurnRefund(client({ owe: { [vaultRow.key]: 5n }, ...o }).c, OWNER, 1n, pr2());
      expect(r.hits[0]!.claimable).toBe(false);
      expect(r.hits[0]!.tx).toBeUndefined();
    }
  });
  it("two-step burn: step 1 is the exact-amount approval to the exact contract, simulated with the claim", async () => {
    const { c, sims } = client({ owe: { digixdao: 1000n } });
    const r = await scanBurnRefund(c, OWNER, 5n, pr2());
    const h = r.hits.find((x) => x.entry.key === "digixdao")!;
    expect(h.owedWei).toBe(2000n);
    expect(h.step).toBe(1);
    expect(h.tx!.to.toLowerCase()).toBe(BURN_SPECS.digixdao!.token.toLowerCase());
    expect(h.tx!.data).toBe(
      encodeFunctionData({
        abi: [APPROVE],
        functionName: "approve",
        args: [BURN_SPECS.digixdao!.claimTo, 1000n],
      }),
    );
    expect(h.tx!.approveMax).toBe(1000n);
    expect(verifyClaimTx(h.tx!, h.tx!.approveMax).verified).toBe(true);
    expect(verifyClaimTx(h.tx!, 999n).verified).toBe(false);
    expect(sims.length).toBe(1);
  });
  it("two-step burn: once approved, step 2 is the claim", async () => {
    const r = await scanBurnRefund(
      client({ owe: { digixdao: 1000n }, allowance: 1000n }).c,
      OWNER,
      5n,
      pr2(),
    );
    const h = r.hits.find((x) => x.entry.key === "digixdao")!;
    expect(h.step).toBe(2);
    expect(h.tx).toMatchObject({ to: BURN_SPECS.digixdao!.claimTo, data: btSelector("burn()") });
    expect(verifyClaimTx(h.tx!).verified).toBe(true);
  });
  it("two-step burn fails closed without eth_simulateV1 or when it reverts", async () => {
    for (const o of [{ noRequest: true }, { simOk: false }]) {
      const r = await scanBurnRefund(
        client({ owe: { digixdao: 1000n }, ...o }).c,
        OWNER,
        5n,
        pr2(),
      );
      expect(r.hits.find((x) => x.entry.key === "digixdao")!.tx).toBeUndefined();
    }
  });
  it("failed rate read is not checked, never zero", async () => {
    const r = await scanBurnRefund(
      client({ owe: { digixdao: 1000n }, failFn: "weiPerNanoDGD" }).c,
      OWNER,
      5n,
      pr2(),
    );
    expect(r.failed).toContain("DigixDAO");
    expect(r.hits.find((x) => x.entry.key === "digixdao")).toBeUndefined();
  });
  it("single-step redeem builds redeem(balance) on aETH", async () => {
    const r = await scanBurnRefund(client({ owe: { aave_v1: 9n } }).c, OWNER, 5n, pr2());
    const h = r.hits.find((x) => x.entry.key === "aave_v1")!;
    expect(h.owedWei).toBe(9n);
    expect(h.step).toBeUndefined();
    expect(h.tx!.data.startsWith(btSelector("redeem(uint256)"))).toBe(true);
  });
  it("scanRegistry merges PR 2 hits with labels and the not-checked count", async () => {
    const r = await scanRegistry(client({ owe: { digixdao: 1000n } }).c, OWNER, 5n);
    const h = r.hits.find((x) => x.entry.key === "digixdao")!;
    expect(h.labels.join(" ")).toMatch(/Two steps/);
    expect(r.notChecked.join(" ")).toMatch(/114 of 296 listed contracts not checked yet/);
  });
});
