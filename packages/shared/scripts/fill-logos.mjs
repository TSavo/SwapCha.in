// Fills missing/broken logoURI in packages/shared/src/tokenList.json from verified fallbacks.
// Usage: node packages/shared/scripts/fill-logos.mjs   (re-run any time tokens are added)
import fs from "fs";

const FILE = new URL("../src/tokenList.json", import.meta.url);
const list = JSON.parse(fs.readFileSync(FILE));
const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const twSlug = {
  1: "ethereum",
  10: "optimism",
  56: "smartchain",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  43114: "avalanchec",
  59144: "linea",
  534352: "scroll",
  792703809: "solana",
  728126428: "tron",
  8253038: "bitcoin",
};
const NATIVE_SLUG = {
  ETH: "ethereum",
  BNB: "smartchain",
  POL: "polygon",
  MATIC: "polygon",
  AVAX: "avalanchec",
  SOL: "solana",
  TRX: "tron",
  BTC: "bitcoin",
};
const lifiChain = (id) => (id === 792703809 ? "SOL" : id);
const isNative = (a) =>
  /^0xe{40}$/i.test(a) ||
  a === "11111111111111111111111111111111" ||
  !/^0x|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ||
  a.length < 30;
async function ok(u) {
  if (!u?.startsWith("https://")) return false;
  try {
    const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    return r.ok && /image/.test(r.headers.get("content-type") || "");
  } catch {
    return false;
  }
}
async function lifi(t) {
  if (t.chainId === 728126428 || t.chainId === 8253038) return null;
  try {
    const r = await fetch(
      `https://li.quest/v1/token?chain=${lifiChain(t.chainId)}&token=${t.address}`,
      { signal: AbortSignal.timeout(10000) },
    );
    return r.ok ? (await r.json()).logoURI : null;
  } catch {
    return null;
  }
}
async function checksum(a) {
  const { getAddress } = await import("viem");
  try {
    return getAddress(a);
  } catch {
    return a;
  }
}
const mainnetBySym = Object.fromEntries(
  list
    .filter((t) => t.chainId === 1 && t.logoURI)
    .map((t) => [t.symbol.replace(/\.e$|\.b$/, ""), t.logoURI]),
);
const symAlias = {
  "WETH.e": "WETH",
  "BTC.b": "WBTC",
  cbBTC: "WBTC",
  BTCB: "WBTC",
  "USDC.e": "USDC",
};
// Optional CoinGecko image fallback written by build-tokenlist.mjs.
const cgImage = fs.existsSync("/tmp/cg_images.json")
  ? JSON.parse(fs.readFileSync("/tmp/cg_images.json"))
  : {};
let fixed = 0;
for (const t of list) {
  if (await ok(t.logoURI)) continue;
  const cands = [];
  const nat = isNative(t.address);
  if (nat && NATIVE_SLUG[t.symbol]) cands.push(`${TW}/${NATIVE_SLUG[t.symbol]}/info/logo.png`);
  if (!nat) {
    cands.push(await lifi(t));
    const addr = t.address.startsWith("0x") ? await checksum(t.address) : t.address;
    if (twSlug[t.chainId]) cands.push(`${TW}/${twSlug[t.chainId]}/assets/${addr}/logo.png`);
  }
  cands.push(
    cgImage[`${t.chainId}:${t.address.startsWith("0x") ? t.address.toLowerCase() : t.address}`],
  );
  if (!nat || !NATIVE_SLUG[t.symbol]) cands.push(mainnetBySym[symAlias[t.symbol] ?? t.symbol]);
  if (NATIVE_SLUG[t.symbol]) cands.push(`${TW}/${NATIVE_SLUG[t.symbol]}/info/logo.png`);
  let got = null;
  for (const c of cands)
    if (await ok(c)) {
      got = c;
      break;
    }
  if (got) {
    t.logoURI = got;
    fixed++;
  } else {
    delete t.logoURI;
    console.warn("no logo:", t.chainId, t.symbol);
  }
}
fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + "\n");
console.log("filled", fixed);
