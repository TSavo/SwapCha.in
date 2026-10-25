/** atom/algo/dot/ton/ada: classified by blocktools, no balance source → own keyless source, never routed to Solana/BTC/Tron. */
import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import { recognisedOnly } from "./ledgers.js";

// public test vectors from the blocktools commits (79d48ca, 1f6da87, cc4c6f4, 78881fd, 5094ded)
const A = {
  atom: ["cosmos1jhg0e7s6gn44tfc5k37kr04sznyhedtc9rzys5", "Cosmos Hub"],
  algo: ["47YPQTIGQEO7T4Y4RWDYWEKV6RTR2UNBQXBABEEGM72ESWDQNCQ52OPASU", "Algorand"],
  dot: ["15rRgsWxz4H5LTnNGcCFsszfXD8oeAFd8QRsR6MbQE2f6XFF", "Polkadot"],
  ton: ["EQCCZtVXlbxxKJbbZti9ESdAkizMyK_CTl0x65osWV1TnF8e", "TON"],
  ada: [
    "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4afdhv",
    "Cardano",
  ],
} as const;

describe("recognised-only chains", () => {
  it("classifies each vector, rejects a bad checksum, leaves BTC/DOGE/Solana/Stellar alone", () => {
    for (const [k, [a]] of Object.entries(A)) expect(recognisedOnly(a), k).toEqual([k]);
    expect(recognisedOnly("cosmos1jhg0e7s6gn44tfc5k37kr04sznyhedtc9rzys4")).toEqual([]);
    expect(recognisedOnly("15rRgsWxz4H5LTnNGcCFsszfXD8oeAFd8QRsR6MbQE2f6XFG")).toEqual([]);
    for (const a of [
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "DQTBF89VKPa63aWDZSuex8ZSwNx97EfBEd",
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
      "So11111111111111111111111111111111111111112",
      "0x0000000000000000000000000000000000000001",
    ])
      expect(recognisedOnly(a), a).toEqual([]);
  });
  it.each(Object.entries(A))(
    "/onchain/money %s → own source only",
    async (_k, [a, name]) => {
      const urls: string[] = [];
      const f = (async (i: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(i instanceof Request ? i.url : i) + String(init?.body ?? ""));
        return new Response("{}", { status: 404 });
      }) as typeof fetch;
      const app = createApp([], {
        env: { FIND_SOURCE_TIMEOUT_MS: "3000" },
        scannerFetch: f,
        pricer: null,
        simulator: null,
        seo: null,
      } as never);
      const res = await app.request(`/onchain/money?address=${a}`);
      expect(res.status).toBe(200);
      const b = (await res.json()) as { notChecked: string[]; checked: string[]; items: unknown[] };
      // every chain is wired: its own source is listed and nothing says "no source wired"
      const SRC = {
        algo: /Algorand algod/,
        atom: /Cosmos Hub LCD/,
        ton: /TON toncenter/,
        ada: /Cardano Koios/,
        dot: /Polkadot Asset Hub/,
      } as const;
      expect(b.checked.join()).toMatch(SRC[_k as keyof typeof SRC]);
      expect(b.notChecked.some((n) => /no source wired/.test(n))).toBe(false);
      // a 404 is a measured empty account for algod/LCD/tonapi; Koios and sidecar/RPC treat it as unavailable
      if (_k === "algo" || _k === "atom" || _k === "ton")
        expect(b.notChecked.some((n) => n.startsWith(name))).toBe(false);
      else expect(b.notChecked.some((n) => n.startsWith(name) && /not checked/.test(n))).toBe(true);
      // only the chain's own sources are asked about this address (shared gas/price lookups are not address scans)
      expect(
        urls.filter(
          (u) =>
            u.includes(a) &&
            !/algonode|nodely|cosmos|polkachu|keplr|publicnode|toncenter|tonapi|koios|parity-chains/.test(
              u,
            ),
        ),
      ).toEqual([]);
    },
    20_000,
  );
});
