// Expands tokenList.json with top tokens per chain by CoinGecko market cap, keeping only
// contracts whose address also appears in LI.FI's token list for that chain (2-source cross-check).
// Inputs (fetch first): /tmp/cg_list.json (coins/list?include_platform=true), /tmp/cg_m{1..N}.json
// (coins/markets pages), /tmp/lifi.json (li.quest/v1/tokens), /tmp/jup.json (lite-api.jup.ag/tokens/v2/tag?query=verified). Then run fill-logos.mjs, and drop any token api.swapchan.com/quote can't route (USDC->token, 2 tries).
import fs from "fs";

const FILE = new URL("../src/tokenList.json", import.meta.url);
const list = JSON.parse(fs.readFileSync(FILE));
const cgList = JSON.parse(fs.readFileSync("/tmp/cg_list.json"));
const markets = [];
for (let p = 1; fs.existsSync(`/tmp/cg_m${p}.json`); p++) {
  const j = JSON.parse(fs.readFileSync(`/tmp/cg_m${p}.json`));
  if (Array.isArray(j)) markets.push(...j);
}
const lifi = JSON.parse(fs.readFileSync("/tmp/lifi.json")).tokens;
const CH = {
  1: ["ethereum", 1, 50],
  10: ["optimistic-ethereum", 10, 50],
  56: ["binance-smart-chain", 56, 50],
  137: ["polygon-pos", 137, 50],
  8453: ["base", 8453, 50],
  42161: ["arbitrum-one", 42161, 50],
  43114: ["avalanche", 43114, 50],
  59144: ["linea", 59144, 50],
  534352: ["scroll", 534352, 50],
  792703809: ["solana", 1151111081099710, 60],
  728126428: ["tron", 728126428, 10],
};
// Popular Solana tokens pinned ahead of market-cap order (still cross-checked).
const PIN = {
  792703809: [
    "bonk",
    "dogwifcoin",
    "popcat",
    "jupiter-exchange-solana",
    "pyth-network",
    "jito-governance-token",
    "raydium",
    "helium",
    "drift-protocol",
    "orca",
    "kamino",
    "wormhole",
    "cat-in-a-dogs-world",
    "moo-deng",
    "gigachad-2",
    "official-trump",
    "pudgy-penguins",
    "fartcoin",
    "book-of-meme",
    "tensor",
    "render-token",
    "pump-fun",
  ],
};
const byId = new Map(markets.map((m) => [m.id, m]));
// Tokenized stocks/ETFs (xStocks, Ondo) are geo-restricted securities, not picker coins.
const STOCK = /xStock|Tokenized|\(Ondo\)|Ondo .*(Stock|ETF)/i;
const jupVerified = new Set(
  fs.existsSync("/tmp/jup.json")
    ? JSON.parse(fs.readFileSync("/tmp/jup.json")).map((t) => t.id)
    : [],
);
const plat = new Map(cgList.map((c) => [c.id, c.platforms || {}]));
const evm = (id) => id < 1e8 && id !== 792703809;
const norm = (id, a) => (evm(id) ? a.toLowerCase() : a);
const dropped = [];
const cgImage = {};
const SKIP = /^(wrapped|bridged|staked|liquid|restaked)?.*(\bstaked\b|restaked|liquid staking)/i;
for (const [idS, [slug, lifiId, cap]] of Object.entries(CH)) {
  const id = Number(idS);
  const have = list.filter((t) => t.chainId === id);
  const seenAddr = new Set(have.map((t) => norm(id, t.address)));
  const seenSym = new Set(have.map((t) => t.symbol.toUpperCase()));
  const lf = new Map((lifi[lifiId] || []).map((t) => [norm(id, t.address), t]));
  const order = [...(PIN[id] || []).map((x) => byId.get(x)).filter(Boolean), ...markets];
  for (const m of order) {
    if (have.length >= cap) break;
    const addr = plat.get(m.id)?.[slug];
    if (!addr) continue;
    const a = norm(id, addr.trim());
    if (seenAddr.has(a)) continue;
    if (STOCK.test(m.name)) {
      dropped.push(`${id} ${m.symbol.toUpperCase()}: tokenized stock`);
      continue;
    }
    const l = lf.get(a);
    if (!l) {
      dropped.push(`${id} ${m.symbol.toUpperCase()}: not in LI.FI list`);
      continue;
    }
    if (
      l.verificationStatus === "unverified" &&
      !jupVerified.has(a) &&
      !(m.market_cap > (id === 728126428 ? 5e7 : 5e8))
    ) {
      dropped.push(`${id} ${l.symbol}: LI.FI unverified`);
      continue;
    }
    const sym = l.symbol;
    if (seenSym.has(sym.toUpperCase())) {
      dropped.push(`${id} ${sym}: duplicate symbol`);
      continue;
    }
    if (!(m.total_volume > 50000)) {
      dropped.push(`${id} ${sym}: <$50k 24h volume`);
      continue;
    }
    const t = {
      chainId: id,
      symbol: sym,
      name: m.name,
      address: evm(id) ? l.address : addr.trim(),
      decimals: l.decimals,
    };
    const logo = l.logoURI?.startsWith("https://") ? l.logoURI : m.image;
    if (logo?.startsWith("https://")) t.logoURI = logo;
    if (t.logoURI !== m.image && m.image) cgImage[`${id}:${a}`] = m.image;
    list.push(t);
    have.push(t);
    seenAddr.add(a);
    seenSym.add(sym.toUpperCase());
  }
}
fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + "\n");
fs.writeFileSync("/tmp/cg_images.json", JSON.stringify(cgImage));
fs.writeFileSync("/tmp/dropped.txt", dropped.join("\n"));
const c = {};
for (const t of list) c[t.chainId] = (c[t.chainId] || 0) + 1;
console.log(c, "dropped", dropped.length);
