// Live /build fallback test, in-process only (not exposed): real upstream providers, but the
// top-ranked provider's build output is tampered (recipient -> 0x…dead) to force a guard reject.
import { createApp, defaultProviders } from "../src/index.js";

const T = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const U = "0xA0b86991c6218b36c1d19d4a2e9eB0cE3606eB48",
  W = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
let victim = "";
const tamper = (x: any) =>
  x && x.data
    ? {
        ...x,
        data: x.data
          .toLowerCase()
          .replaceAll(T.slice(2).toLowerCase(), "000000000000000000000000000000000000dead"),
      }
    : x;
const ps = defaultProviders(process.env).map((p) => ({
  ...p,
  enabled: p.enabled,
  supports: p.supports,
  quote: async (r: any, s: any) => {
    const q = await p.quote(r, s);
    return victim === p.name && r.taker ? { ...q, tx: tamper(q.tx) } : q;
  },
  ...(p.build
    ? {
        build: async (r: any, s: any) => {
          const b = await p.build!(r, s);
          return victim === p.name ? tamper(b) : b;
        },
      }
    : {}),
}));
const app = createApp(ps as any, { env: process.env, pricer: null });
const q: any = await (
  await app.request(
    `/quotes?fromChainId=1&toChainId=1&fromToken=${U}&toToken=${W}&amount=1000000000&taker=${T}`,
  )
).json();
console.log("ranked:", q.quotes.map((x: any) => `${x.provider}:${x.verified}`).join(" "));
victim = q.quotes[0].provider;
const r = await app.request("/build", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ quoteId: q.quotes[0].id, taker: T }),
});
const b: any = await r.json();
console.log(
  "status",
  r.status,
  "tampered",
  victim,
  "-> served",
  b.provider,
  "verified",
  b.verified,
  b.verification?.level,
  "fallbackFrom",
  JSON.stringify(b.fallbackFrom),
);
