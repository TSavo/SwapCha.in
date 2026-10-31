import { base58, bech32, hex } from "@scure/base";
import * as bitcoin from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { btDecode } from "../blocktools.js";
import type { GuardCtx } from "./ctx.js";
import { needles, type Payload, verifyPayload } from "./index.js";

/**
 * Behaviour-equivalence coverage for the blocktools migration of checkBtc + needles(). The byte patterns
 * and output addresses the guard now reads from the vendored wasm must match the hand-rolled @scure path
 * on every vector the old code handled, and the wasm decodes the Taproot scripts the old (no-ECC)
 * bitcoin.address.fromOutputScript path could not.
 */

const toHex = (u: Uint8Array) => Buffer.from(u).toString("hex");

describe("needles(): blocktools base58 == @scure base58, bech32 kept hand-rolled", () => {
  it("Tron address -> 0x41-stripped 20-byte hash (byte-for-byte)", () => {
    for (const a of [
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      "TLa2f6VPqDgRE67v7c1J19m7nfgfEoYQA2",
      "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
    ])
      expect(needles(a)).toContain(toHex(base58.decode(a).slice(1, 21)));
  });
  it("32-byte base58 (Solana) -> raw 32-byte hex (byte-for-byte)", () => {
    for (const a of [
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    ])
      expect(needles(a)).toContain(toHex(base58.decode(a)));
  });
  it("bc1 address: still emits the witness-program bytes AND the raw 5-bit words", () => {
    const a = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    const w = bech32.decode(a as `${string}1${string}`);
    expect(needles(a)).toContain(hex.encode(bech32.fromWords(w.words.slice(1))));
    expect(needles(a)).toContain(hex.encode(Uint8Array.from(w.words.slice(1))));
  });
});

describe("blocktools decodes script kinds the old fromOutputScript path could not", () => {
  it("Taproot (P2TR) output script -> bc1p address (old path throws without initEccLib)", () => {
    const p2trScript = `5120${"d6889cb081036e0faefa3a35157ad71086be123854d7d2b43a64cf0eb1a35099"}`;
    expect(() =>
      bitcoin.address.fromOutputScript(hex.decode(p2trScript), bitcoin.networks.bitcoin),
    ).toThrow();
    const p = new bitcoin.Psbt();
    p.addInput({
      hash: "11".repeat(32),
      index: 0,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
        value: 1000000n,
      },
    });
    p.addOutput({ script: hex.decode(p2trScript), value: 12345n });
    const dec = btDecode(p.toBase64(), "btc")!;
    const o = dec.find((x) => x.role === "output" && x.index === 0)!;
    expect(o.kind).toBe("p2tr");
    expect(o.address).toMatch(/^bc1p/);
  });
});

const TAKER = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const VAULT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const OTHER = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 2) }).address!;
const DEST = "0xeb0ec7a28e4b6b175806e21d9d3afe45792c5c7b";
const WETH = "0xc02aaa39b223fe8d0a5e5b5c4f27ead9083c756c";
const BTC_CHAIN = 8253038;

const ctx: GuardCtx = {
  thorInbound: async () => [{ chain: "BTC", address: VAULT } as never],
  relay: async () => ({ contracts: [], solvers: [] }),
  zeroxSettlers: async () => [],
};

const psbtPayload = (vault: string, memo: string, vaultValue = 50000n) => {
  const p = new bitcoin.Psbt();
  p.addInput({
    hash: "11".repeat(32),
    index: 0,
    witnessUtxo: { script: bitcoin.address.toOutputScript(TAKER), value: 100000n },
  });
  p.addOutput({ address: vault, value: vaultValue });
  p.addOutput({ address: TAKER, value: 49000n }); // change
  p.addOutput({
    script: bitcoin.payments.embed({ data: [Buffer.from(memo, "utf8")] }).output!,
    value: 0n,
  });
  return {
    provider: "thorchain",
    req: {
      fromChainId: BTC_CHAIN,
      toChainId: 1,
      fromToken: "btc",
      toToken: WETH,
      amount: "100000",
      taker: TAKER,
      slippageBps: 50,
      recipient: DEST,
    },
    toAmount: "1000000000000000000",
    nonEvmTx: { vm: "bvm", kind: "bvm-psbt", data: p.toBase64() },
  } as unknown as Payload;
};

const failedNames = async (p: Payload) =>
  (await verifyPayload(p, ctx)).checks.filter((c) => !c.ok).map((c) => c.name);

describe("checkBtc: blocktools is the primary output decoder (decisions unchanged)", () => {
  it("accepts an honest THORChain BTC deposit", async () => {
    const v = await verifyPayload(psbtPayload(VAULT, `=:ETH.ETH:${DEST}:1`), ctx);
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.verified).toBe(true);
  });
  it("rejects payment to a non-vault output (router)", async () => {
    expect(await failedNames(psbtPayload(OTHER, `=:ETH.ETH:${DEST}:1`))).toContain("router");
  });
  it("rejects a memo paying someone else (recipient)", async () => {
    expect(
      await failedNames(
        psbtPayload(VAULT, `=:ETH.ETH:0x000000000000000000000000000000000000dead:1`),
      ),
    ).toContain("recipient");
  });
  it("rejects a vault payment above the sell amount (value)", async () => {
    expect(await failedNames(psbtPayload(VAULT, `=:ETH.ETH:${DEST}:1`, 200000n))).toContain(
      "value",
    );
  });
});
