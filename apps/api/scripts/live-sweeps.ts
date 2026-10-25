/** Live check (single requests, read-only): build each coin's sweep from a real funded address, require the blocktools path. */
import { utxoSweep, type Coin } from "../src/utxochains.js";
const A: Partial<Record<Coin, string>> = JSON.parse(process.argv[2]!);
await Promise.all(
  Object.entries(A).map(async ([k, a]) => {
    const t = Date.now();
    try {
      const s = (await Promise.race([
        utxoSweep(fetch, k as Coin, a!, a!),
        new Promise((_, r) => setTimeout(() => r(new Error("timeout 30s")), 30000)),
      ])) as { builtBy?: string; verified?: { txid: string; warnings: string[] }; txFormat?: string; inputs: unknown[]; fee: string; amount: string };
      console.log(k, s.builtBy ?? "TS-FALLBACK(unverified)", s.txFormat, "inputs", s.inputs.length, "fee", s.fee, "amt", s.amount, "txid", s.verified?.txid, s.verified?.warnings, `${Date.now() - t}ms`);
    } catch (e) {
      console.log(k, "ERR", String((e as Error).message).slice(0, 160), `${Date.now() - t}ms`);
    }
  }),
);
