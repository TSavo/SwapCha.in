import { describe, expect, it } from "vitest";
import { isXlmAddress, xlmScan } from "./ledgers.js";

const G = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
describe("Stellar (blocktools detectAddress xlm + Horizon)", () => {
  it("classifies G-addresses through blocktools, rejects a bad checksum and other formats", () => {
    expect(isXlmAddress(G)).toBe(true);
    expect(isXlmAddress(G.slice(0, -1) + "A")).toBe(false);
    expect(isXlmAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(false);
  });
  it("spendable = balance - (2 + subentries) x base reserve - selling liabilities; assets are leads", async () => {
    const f = (async (u: string) =>
      u.includes("/accounts/")
        ? json({
            subentry_count: 1,
            balances: [
              { asset_type: "native", balance: "10.0000000", selling_liabilities: "1.0000000" },
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDC",
                asset_issuer: "GA5Z",
                balance: "5.0000000",
              },
            ],
          })
        : u.includes("/ledgers")
          ? json({ _embedded: { records: [{ base_reserve_in_stroops: 5000000, sequence: 1 }] } })
          : json({})) as unknown as typeof fetch;
    const r = await xlmScan(f, G);
    expect(r.items[0]!.what).toMatch(/^7\.5 XLM spendable/);
    expect(r.items[1]!.what).toMatch(/USDC/);
  });
  it("an unfunded account (Horizon 404) is a measured zero; an outage is not checked", async () => {
    const nf = (async (u: string) =>
      u.includes("/accounts/")
        ? json({}, 404)
        : json({
            _embedded: { records: [{ base_reserve_in_stroops: 5000000, sequence: 1 }] },
          })) as unknown as typeof fetch;
    expect(await xlmScan(nf, G)).toEqual({ items: [], notChecked: [] });
    const down = (async () => json({}, 503)) as unknown as typeof fetch;
    expect((await xlmScan(down, G)).notChecked[0]).toMatch(/Stellar/);
  });
});
