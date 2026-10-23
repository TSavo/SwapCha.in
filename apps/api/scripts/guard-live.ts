/** Live check: fetch quotes from an API and re-verify every payload locally. Usage: tsx scripts/guard-live.ts [base] */
import { liveGuardCtx, quotePayload, verifyPayload, failures } from "../src/guard/index.js";
const base = process.argv[2] ?? "https://api.swapchan.com";
const EVM = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";
const SOL = "BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE";
const TRX = "TULPYGfQ8U44XkhiX3oa3BaXdNPu6M5U3Z";
const BTC = "bc1qy65xajxwrtp62uk3styn9py7m2k06cdj2wla6n";
const N = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const cases: Record<string, string>[] = [
  { fromChainId: "1", toChainId: "1", fromToken: N, toToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "10000000000000000", taker: EVM },
  { fromChainId: "1", toChainId: "1", fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", toToken: N, amount: "50000000", taker: EVM },
  { fromChainId: "8453", toChainId: "8453", fromToken: N, toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "10000000000000000", taker: EVM },
  { fromChainId: "42161", toChainId: "42161", fromToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", toToken: N, amount: "20000000", taker: EVM },
  { fromChainId: "42161", toChainId: "8453", fromToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "20000000", taker: EVM },
  { fromChainId: "1", toChainId: "8253038", fromToken: N, toToken: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", amount: "50000000000000000", taker: EVM, recipient: BTC },
  { fromChainId: "8453", toChainId: "792703809", fromToken: N, toToken: "11111111111111111111111111111111", amount: "10000000000000000", taker: EVM, recipient: SOL },
  { fromChainId: "792703809", toChainId: "792703809", fromToken: "11111111111111111111111111111111", toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "100000000", taker: SOL },
  { fromChainId: "792703809", toChainId: "42161", fromToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", toToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", amount: "20000000", taker: SOL, recipient: EVM },
  { fromChainId: "728126428", toChainId: "1", fromToken: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", toToken: N, amount: "500000000", taker: TRX, recipient: EVM },
  { fromChainId: "8253038", toChainId: "1", fromToken: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", toToken: N, amount: "1000000", taker: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo", recipient: EVM },
];
const ctx = liveGuardCtx();
for (const c of cases) {
  const r = (await (await fetch(`${base}/quotes?${new URLSearchParams(c)}`)).json()) as any;
  console.log(`\n== ${c.fromChainId}->${c.toChainId}`);
  for (const q of r.quotes ?? []) {
    const v = await verifyPayload(quotePayload(q), ctx);
    console.log(`${q.provider.padEnd(10)} ${v.verified ? "OK " : "BAD"} ${v.level.padEnd(10)} ${failures(v)} ${q.verification ? `(server: ${q.verification.verified})` : ""}`);
  }
  for (const e of r.errors ?? []) console.log(`${e.provider.padEnd(10)} ERR ${String(e.message).slice(0, 100)}`);
}
