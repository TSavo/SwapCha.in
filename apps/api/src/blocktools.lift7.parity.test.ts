import { encodeFunctionData, erc20Abi, keccak256, serializeTransaction } from "viem";
import { describe, expect, it } from "vitest";
import { blocktools } from "./blocktools.js";
import { pickSweepUtxos } from "./utxochains.js";

// Parity of blocktools b580bde exports against SwapChan's own code on a seeded corpus.
// buildEvmTransfer vs viem serializeTransaction of the tx objects evmSweep/forkSweep return (and 1559 equivalents);
// selectUtxos vs pickSweepUtxos (the selection utxoSweep uses).
const w = blocktools() as any;
let seed = 0x5eed;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const big = (lo: number, hi: number) => BigInt(Math.floor(lo + rnd() * (hi - lo)));
const addr = () =>
  `0x${Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("")}` as `0x${string}`;
const CHAINS = [
  1, 61, 10001, 513100, 324, 100, 5000, 42220, 81457, 80094, 146, 130, 250, 143, 747474, 999,
];

type Case = {
  kind: string;
  req: Record<string, unknown>;
  ours: Parameters<typeof serializeTransaction>[0];
};
function evmCorpus(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const chainId = CHAINS[i % CHAINS.length]!;
    const nonce = Number(big(0, 5000));
    const gasPrice = big(1, 3e11);
    const to = addr();
    const mode = i % 6; // 0 native value, 1 native sweep, 2 erc20 (legacy) ; 3-5 same, eip1559
    const tip = mode >= 3 ? (gasPrice * big(0, 100)) / 100n : undefined;
    const fee = tip === undefined ? {} : { maxPriorityFeePerGas: tip.toString() };
    const t = mode % 3;
    if (t === 2) {
      const token = addr();
      const bal = big(1, 1e15) * big(1, 1e6);
      const gas = big(40000, 130000);
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, bal] });
      out.push({
        kind: `erc20/${tip === undefined ? "legacy" : "1559"}`,
        req: {
          chainId,
          nonce,
          gas: gas.toString(),
          gasPrice: gasPrice.toString(),
          to,
          token,
          balance: bal.toString(),
          ...fee,
        },
        ours:
          tip === undefined
            ? { type: "legacy", chainId, nonce, gas, gasPrice, to: token, value: 0n, data }
            : {
                type: "eip1559",
                chainId,
                nonce,
                gas,
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: tip,
                to: token,
                value: 0n,
                data,
              },
      });
    } else {
      const gas = t === 1 ? 21000n : big(21000, 60000);
      const bal = gas * gasPrice + big(1, 1e18);
      // forkSweep / evmSweep: value = balance - gas x gasPrice
      const value = t === 1 ? bal - gas * gasPrice : big(1, 1e18);
      out.push({
        kind: `${t === 1 ? "sweep" : "native"}/${tip === undefined ? "legacy" : "1559"}`,
        req: {
          chainId,
          nonce,
          gas: gas.toString(),
          gasPrice: gasPrice.toString(),
          to,
          ...(t === 1 ? { balance: bal.toString() } : { value: value.toString() }),
          ...fee,
        },
        ours:
          tip === undefined
            ? { type: "legacy", chainId, nonce, gas, gasPrice, to, value }
            : {
                type: "eip1559",
                chainId,
                nonce,
                gas,
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: tip,
                to,
                value,
              },
      });
    }
  }
  return out;
}

describe("buildEvmTransfer parity with viem", () => {
  it("byte-identical unsigned tx and sighash on 600 cases", () => {
    const corpus = evmCorpus(600);
    const diffs: string[] = [];
    const kinds: Record<string, number> = {};
    for (const c of corpus) {
      const bt = JSON.parse(w.buildEvmTransfer(JSON.stringify(c.req)));
      const ours = serializeTransaction(c.ours);
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      if (bt.unsigned !== ours || bt.sighash !== keccak256(ours))
        diffs.push(`${c.kind} ${JSON.stringify(c.req)}`);
    }
    console.log(JSON.stringify({ evm: corpus.length, kinds, diffs: diffs.length }));
    expect(diffs).toEqual([]);
  });
  it("refuses what our builders would also refuse or never produce", () => {
    const base = { chainId: 1, nonce: 0, gas: "21000", gasPrice: "10", to: addr() };
    expect(() => w.buildEvmTransfer(JSON.stringify({ ...base, balance: "210000" }))).toThrow(); // balance == fee
    expect(() =>
      w.buildEvmTransfer(JSON.stringify({ ...base, value: "1", balance: "9" })),
    ).toThrow();
    expect(() =>
      w.buildEvmTransfer(JSON.stringify({ ...base, value: "1", maxPriorityFeePerGas: "11" })),
    ).toThrow();
    expect(() =>
      w.buildEvmTransfer(JSON.stringify({ ...base, gas: "20999", value: "1" })),
    ).toThrow();
  });
});

describe("selectUtxos parity with pickSweepUtxos", () => {
  it("same selection, order and total on 400 sets (foreign scripts, fee dust, >200)", () => {
    const own = `76a914${"ab".repeat(20)}88ac`;
    const p2pk = `21${"02".padEnd(66, "c")}ac`;
    let diffs = 0;
    let sawCap = 0;
    let sawDust = 0;
    for (let i = 0; i < 400; i++) {
      const rate = [1, 2, 6, 20, 120, 1000, 100312][i % 7]!;
      const n = i % 10 === 0 ? 250 + Math.floor(rnd() * 200) : Math.floor(rnd() * 60);
      const min = rate * 148 * 20;
      const all = Array.from({ length: n }, (_, k) => {
        const r = rnd();
        const value =
          r < 0.3
            ? big(1, min)
            : r < 0.35
              ? BigInt(min)
              : r < 0.4
                ? BigInt(min - 1)
                : big(min, min * 1000);
        // duplicate values exercise sort stability
        return {
          txid: `${(i * 1000 + k).toString(16).padStart(64, "0")}`,
          vout: k % 3,
          value: (rnd() < 0.1 && k ? 7777777n * BigInt(rate) : value).toString(),
          script: rnd() < 0.15 ? p2pk : own,
        };
      });
      const ours = pickSweepUtxos(all, own, rate);
      const bt = JSON.parse(w.selectUtxos(JSON.stringify(all), own, rate));
      const a = ours.take.map((u) => `${u.txid}:${u.vout}`);
      const b = bt.selected.map((u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`);
      const total = ours.take.reduce((s, u) => s + BigInt(u.value), 0n).toString();
      if (JSON.stringify(a) !== JSON.stringify(b) || total !== bt.total) diffs++;
      if (bt.dropped_cap) sawCap++;
      if (bt.dropped_uneconomic) sawDust++;
    }
    console.log(JSON.stringify({ utxoSets: 400, diffs, withCap: sawCap, withDust: sawDust }));
    expect(diffs).toBe(0);
    expect(sawCap).toBeGreaterThan(0);
  });
  it("known difference: a UTXO with no script is kept by SwapChan, dropped as foreign by blocktools", () => {
    const own = `76a914${"ab".repeat(20)}88ac`;
    const all = [{ txid: "11".repeat(32), vout: 0, value: "100000000" }];
    expect(pickSweepUtxos(all, own, 6).take.length).toBe(1);
    expect(JSON.parse(w.selectUtxos(JSON.stringify(all), own, 6)).count).toBe(0);
  });
});
