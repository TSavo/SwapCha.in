/**
 * Regression: every old coin's sample address must reach its own explorer through the real HTTP route
 * (/onchain/money), not fall through to the Solana ("svm") or a sibling coin's path. A coins-less build
 * routed DASH to Solana sources and MONA to Litecoin only; this catches that at the route, not just coinsOf.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { COINS, type Coin, convert } from "./utxochains.js";

const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
/** Real on-chain addresses where a BTC conversion does not exist (GRS uses its own checksum). */
const REAL: Partial<Record<Coin, string>> = {
  dash: "XssjzLKgsfATYGqTQmiJURQzeKdpL5K1k3",
  dgb: "DQTBF89VKPa63aWDZSuex8ZSwNx97EfBEd",
  rvn: "RHUC17zAVjNqXDtkqwLPRvQ2XgoRZsXeeG",
  vtc: "VbPe6e9gGZaT87YWnJ5kTqtM2X9yDRHdq1",
  via: "VqvtxyYbwWufXGahdVaE7xH5jMg5jUiKWb",
  grs: "Fr5m2irs9vNWSAFXJK6KPtxqW9YWg384FX",
  ppc: "PKbuwmUS9NWB6kqiWpfuhUfeBKue39D6XZ",
  mona: "MG2m1jxj22suBNAWocawtdSKGCiFEqTTK1",
  zec: "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
};
const hostOf = (u: string) => new URL(u).host;

async function scan(address: string) {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const app = createApp([], {
    env: { CRYPTOID_API_KEY: "test", FIND_SOURCE_TIMEOUT_MS: "3000" },
    scannerFetch: f,
    pricer: null,
    simulator: null,
    seo: null,
  } as never);
  const res = await app.request(`/onchain/money?address=${address}`);
  const body = (await res.json()) as { checked?: string[]; notChecked?: string[] };
  return { status: res.status, urls, text: JSON.stringify([body.checked, body.notChecked]) };
}

describe("/onchain/money routes every old coin to its own sources", () => {
  const cases = (Object.keys(COINS) as Coin[])
    .map((k) => [k, REAL[k] ?? convert(BTC, k)] as const)
    .filter((c): c is readonly [Coin, string] => !!c[1] && c[0] !== "btc");
  it.each(cases)(
    "%s %s",
    async (k, addr) => {
      const r = await scan(addr);
      expect(r.status).toBe(200);
      expect(r.text).not.toMatch(/Solana|Kamino/);
      const row = COINS[k] as { name: string; src: { type: string; urls?: string[] } | null };
      const hosts = (row.src?.urls ?? []).map(hostOf);
      const hit = r.urls.some((u) =>
        row.src?.type === "cryptoid"
          ? /cryptoid/.test(u) && u.includes(`/${k}/`)
          : hosts.includes(hostOf(u)),
      );
      expect(hit || r.text.includes(row.name)).toBe(true);
    },
    20_000,
  );
});
