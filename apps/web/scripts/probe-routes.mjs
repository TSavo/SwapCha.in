// Probe candidate SEO routes against the live API and keep only those that quote.
//   node apps/web/scripts/probe-routes.mjs [apiUrl]  -> apps/web/src/lib/routes.json
import { readFileSync, writeFileSync } from "node:fs";

const API = process.argv[2] ?? "https://api.swapchan.com";
const root = new URL("../../../", import.meta.url);
const list = JSON.parse(readFileSync(new URL("packages/shared/src/tokenList.json", root)));
const CHAINS = {
  1: "ethereum",
  10: "optimism",
  56: "bnb",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  43114: "avalanche",
  59144: "linea",
  534352: "scroll",
  792703809: "solana",
  8253038: "bitcoin",
  728126428: "tron",
};
const NATIVE = {
  1: "ETH",
  10: "ETH",
  56: "BNB",
  137: "POL",
  8453: "ETH",
  42161: "ETH",
  43114: "AVAX",
  59144: "ETH",
  534352: "ETH",
  792703809: "SOL",
  8253038: "BTC",
  728126428: "TRX",
};
const AMOUNT = {
  ETH: "0.05",
  BNB: "0.2",
  POL: "500",
  AVAX: "5",
  SOL: "0.7",
  BTC: "0.002",
  TRX: "500",
  USDC: "100",
  USDT: "100",
};
const VM = { 792703809: "svm", 8253038: "bvm", 728126428: "tvm" };
const ADDR = {
  evm: "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B",
  svm: "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE",
  bvm: "bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n",
  tvm: "TULPYGfQ8U44XkhiX3oa3BaXdNPu6M5U3Z",
};
const vm = (c) => VM[c] ?? "evm";
const tok = (c, sym) => {
  const t = list.find((x) => x.chainId === Number(c) && x.symbol === sym);
  return t && { symbol: t.symbol, address: t.address, decimals: t.decimals };
};
const ids = Object.keys(CHAINS).map(Number);
const cand = [];
const add = (fc, fs, tc, ts) => {
  const a = tok(fc, fs),
    b = tok(tc, ts);
  if (a && b && !(fc === tc && fs === ts)) cand.push({ fc, tc, a, b });
};
for (const c of ids)
  for (const s of ["USDC", "USDT"]) {
    add(c, NATIVE[c], c, s);
    add(c, s, c, NATIVE[c]);
  }
for (const f of ids)
  for (const t of ids)
    if (f !== t) {
      add(f, NATIVE[f], t, NATIVE[t]);
      add(f, "USDC", t, "USDC");
      add(f, "USDT", t, "USDT");
      if (vm(t) !== "evm" || vm(f) !== "evm") {
        add(f, "USDC", t, NATIVE[t]);
        add(f, NATIVE[f], t, "USDC");
      }
    }
const toBase = (amt, d) => {
  const [i, f = ""] = amt.split(".");
  return (BigInt(i) * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0")).toString();
};
const out = [];
async function probe(r) {
  const amount = AMOUNT[r.a.symbol];
  const qs = new URLSearchParams({
    fromChainId: r.fc,
    toChainId: r.tc,
    fromToken: r.a.address,
    toToken: r.b.address,
    amount: toBase(amount, r.a.decimals),
    taker: ADDR[vm(r.fc)],
    recipient: ADDR[vm(r.tc)],
  });
  try {
    const res = await fetch(`${API}/quotes?${qs}`, { signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    const n = j.quotes?.length ?? 0;
    if (n > 0)
      out.push({
        slug: `${r.a.symbol}-${CHAINS[r.fc]}-to-${r.b.symbol}-${CHAINS[r.tc]}`.toLowerCase(),
        fromChainId: r.fc,
        toChainId: r.tc,
        fromToken: r.a,
        toToken: r.b,
        amount,
        providers: [...new Set(j.quotes.map((q) => q.provider))].sort(),
      });
    process.stdout.write(n ? "+" : ".");
  } catch {
    process.stdout.write("x");
  }
}
console.log(`${cand.length} candidates`);
const q = [...cand];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (q.length) await probe(q.shift());
  }),
);
out.sort((x, y) => x.slug.localeCompare(y.slug));
writeFileSync(new URL("apps/web/src/lib/routes.json", root), `${JSON.stringify(out, null, 1)}\n`);
console.log(`\n${out.length} routes quote`);
