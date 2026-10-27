import { describe, expect, it } from "vitest";
import { btSelector } from "../blocktools.js";
import { registryCollisions, verifyClaimTx } from "../intel.js";
import { REFUND_CLAIM, REFUND_VIEWS, validBurnRefund } from "./burnrefund.js";
import { labels, REGISTRY, scanned, scanRegistry } from "./registry.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const pr4 = () => scanned().filter((e) => e.confirmedAtBlock === 26280568);

describe("LegacyETH PR 4", () => {
  it("14 rows confirmed at block 26280568, counted by family", () => {
    const n: Record<string, number> = {};
    for (const e of pr4()) n[e.family] = (n[e.family] ?? 0) + 1;
    expect(n).toEqual({
      "etherdelta-dex": 1,
      "weth-wrapper": 3,
      "presale-safe-withdrawal": 2,
      "pull-payment": 5,
      "refund-withdraw": 2,
      "presale-withdraw": 1,
    });
    expect(scanned().length).toBe(178);
    expect(REGISTRY.filter((e) => e.status === "not-checked").length).toBe(112);
    expect(registryCollisions()).toEqual([]);
  });
  it("new refund families are pinned in code; views on the contract itself", () => {
    expect(REFUND_CLAIM["pull-payment"]).toBe("withdraw()");
    expect(REFUND_CLAIM["refund-withdraw"]).toBe("withdrawRefund()");
    for (const e of pr4().filter((x) => x.family in REFUND_CLAIM)) {
      expect(e.claim).toBe(REFUND_CLAIM[e.family]);
      expect(REFUND_VIEWS.has(e.view!)).toBe(true);
      expect(e.viewOn).toBe("self");
      expect(validBurnRefund({ ...e, claim: "withdraw(uint256)" })).toBe(false);
      expect(validBurnRefund({ ...e, view: "owner()" })).toBe(false);
      expect(validBurnRefund({ ...e, viewOn: undefined })).toBe(false);
    }
  });
  it("pull payment: pendingWithdrawals(owner) then withdraw(), labelled; fails closed", async () => {
    const m = REGISTRY.find((e) => e.key === "mooncatrescue")!;
    const mk = (o: { fail?: boolean; held?: bigint; simOk?: boolean }) =>
      ({
        multicall: async (a: { contracts: { functionName: string; address: string }[] }) =>
          a.contracts.map((x) =>
            x.address.toLowerCase() === m.address.toLowerCase()
              ? o.fail
                ? { status: "failure", error: new Error("x") }
                : { status: "success", result: 7n * 10n ** 18n }
              : { status: "success", result: 0n },
          ),
        getBalance: async () => o.held ?? 10n ** 24n,
        call: async () => {
          if (o.simOk === false) throw new Error("revert");
          return { data: "0x" };
        },
        request: async () => {
          throw new Error("method not found");
        },
      }) as never;
    const r = await scanRegistry(mk({}), OWNER, 9n);
    const h = r.hits.find((x) => x.entry.key === m.key)!;
    expect(h.owedWei).toBe(7n * 10n ** 18n);
    expect(h.claimable).toBe(true);
    expect(h.evidence[0]!.call).toBe("pendingWithdrawals(address)");
    expect(h.tx!.data).toBe(btSelector("withdraw()"));
    expect(verifyClaimTx(h.tx!).verified).toBe(true);
    expect(labels(m, 1n, 2n).join(" ")).toMatch(/Pull payment/);
    for (const o of [{ held: 1n }, { simOk: false }]) {
      const x = (await scanRegistry(mk(o), OWNER, 9n)).hits.find((y) => y.entry.key === m.key)!;
      expect(x.claimable).toBe(false);
      expect(x.tx).toBeUndefined();
    }
    const f = await scanRegistry(mk({ fail: true }), OWNER, 9n);
    expect(f.hits.find((y) => y.entry.key === m.key)).toBeUndefined();
    expect(f.notChecked.join(" ")).toMatch(/MoonCat/i);
  });
});
