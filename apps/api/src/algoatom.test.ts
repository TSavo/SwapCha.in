import { describe, expect, it } from "vitest";
import { algoScan, atomScan } from "./ledgers.js";

const ALGO = "47YPQTIGQEO7T4Y4RWDYWEKV6RTR2UNBQXBABEEGM72ESWDQNCQ52OPASU";
const ATOM = "cosmos1jhg0e7s6gn44tfc5k37kr04sznyhedtc9rzys5";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const px = (u: string) =>
  u.includes("coins.llama.fi")
    ? json({ coins: { "coingecko:algorand": { price: 0.2 }, "coingecko:cosmos": { price: 5 } } })
    : null;

describe("Algorand (algod)", () => {
  it("spendable = amount - min-balance, as a Spendable balance; falls back to the second node", async () => {
    const hit: string[] = [];
    const f = (async (u: string) => {
      hit.push(u);
      return (
        px(u) ??
        (u.includes("algonode")
          ? json({}, 503)
          : json({ amount: 12_345_678, "min-balance": 200_000, "total-assets-opted-in": 1 }))
      );
    }) as unknown as typeof fetch;
    const r = await algoScan(f, ALGO);
    expect(hit.some((u) => u.includes("nodely"))).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.kind).toBe("balance");
    expect(r.items[0]!.what).toMatch(
      /^12\.145678 ALGO spendable .*minus 0\.2 ALGO minimum balance.*1 asset opt-in/,
    );
    expect(r.items[0]!.valueUsd).toBe(2.43);
  });
  it("all nodes down → one not-checked line; empty account → nothing", async () => {
    const down = (async (u: string) => px(u) ?? json({}, 503)) as unknown as typeof fetch;
    expect((await algoScan(down, ALGO)).notChecked[0]).toMatch(/^Algorand \(algod\): not checked/);
    const empty = (async (u: string) =>
      px(u) ?? json({ amount: 0, "min-balance": 100000 })) as unknown as typeof fetch;
    expect(await algoScan(empty, ALGO)).toEqual({ items: [], notChecked: [] });
  });
});

describe("Cosmos Hub (LCD)", () => {
  it("liquid = spendable balance, rewards claimable, staked/unbonding/other denoms as leads; LCD fallback", async () => {
    const f = (async (u: string) => {
      const p = px(u);
      if (p) return p;
      if (u.startsWith("https://cosmos-rest.publicnode.com")) return json({}, 500);
      if (u.includes("/bank/"))
        return json({
          balances: [
            { denom: "uatom", amount: "7618119" },
            { denom: "ibc/AB", amount: "5" },
          ],
        });
      if (u.includes("/unbonding_delegations"))
        return json({
          unbonding_responses: [
            { entries: [{ balance: "1000000", completion_time: "2026-11-10T00:00:00Z" }] },
          ],
        });
      if (u.includes("/delegations/"))
        return json({
          delegation_responses: [{ balance: { denom: "uatom", amount: "590000000" } }],
        });
      if (u.includes("/rewards"))
        return json({ total: [{ denom: "uatom", amount: "1633939.0972" }] });
      return json({}, 404);
    }) as unknown as typeof fetch;
    const r = await atomScan(f, ATOM);
    const by = Object.fromEntries(r.items.map((i) => [i.protocol, i]));
    expect(by["Cosmos Hub"]!.kind).toBe("balance");
    expect(by["Cosmos Hub"]!.what).toMatch(/^7\.618119 ATOM spendable/);
    expect(by["Cosmos Hub"]!.valueUsd).toBe(38.09);
    expect(by["Cosmos Hub staking rewards"]!.what).toMatch(
      /^1\.633939 ATOM in unclaimed staking rewards/,
    );
    expect(by["Cosmos Hub staked"]!.kind).toBe("lead");
    expect(by["Cosmos Hub staked"]!.what).toMatch(/^590 ATOM staked/);
    expect(by["Cosmos Hub unbonding"]!.what).toMatch(/^1 ATOM unbonding.*2026-11-10/);
    expect(by["Cosmos Hub tokens"]!.what).toMatch(/^1 other token denom/);
  });
  it("every LCD down → one not-checked line", async () => {
    const down = (async (u: string) => px(u) ?? json({}, 502)) as unknown as typeof fetch;
    const r = await atomScan(down, ATOM);
    expect(r.items).toEqual([]);
    expect(r.notChecked[0]).toMatch(/^Cosmos Hub \(LCD\): not checked/);
  });
});
