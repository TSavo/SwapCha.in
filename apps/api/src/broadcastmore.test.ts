import {
  BROADCAST_CHAINS,
  BROADCAST_COUNT,
  BROADCAST_EXTRA,
  broadcastSummary,
} from "@swapchan/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  broadcastExtra,
  broadcastLimiter,
  extraBroadcastChain,
  routeBroadcast,
} from "./broadcastmore.js";
import { chainOf } from "./onchain.js";
import { broadcastTx } from "./txtools.js";

// Network is always mocked: these tests never reach a real node and nothing is ever broadcast.
type Call = { url: string; init: RequestInit };
const mock = (reply: (c: Call) => { status?: number; body: unknown }) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = reply(c);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const down = mock(() => {
  throw new Error("ECONNREFUSED");
});
const chain = (k: string) => {
  const c = extraBroadcastChain(k);
  if (!c) throw new Error(`no ${k}`);
  return c;
};
const signEvm = async (chainId: number | undefined, legacy = false) => {
  const acct = privateKeyToAccount(generatePrivateKey()); // fresh, unfunded, never sent anywhere real
  const raw = await acct.signTransaction(
    legacy
      ? {
          to: acct.address,
          value: 1n,
          nonce: 0,
          gas: 21000n,
          gasPrice: 1n,
          type: "legacy",
          ...(chainId ? { chainId } : {}),
        }
      : {
          chainId: chainId!,
          to: acct.address,
          value: 1n,
          nonce: 0,
          gas: 21000n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
          type: "eip1559",
        },
  );
  return { raw, from: acct.address };
};
const UTXO_HEX = `0200000001${"ab".repeat(32)}00000000${"00".repeat(40)}`;

describe("broadcast chain table", () => {
  it("is 51 chains: 23 EVM, 18 Bitcoin-family, 10 other", () => {
    expect(BROADCAST_COUNT).toBe(51);
    const fam = (f: (x: string) => boolean) => BROADCAST_CHAINS.filter((c) => f(c.family)).length;
    expect(fam((x) => x === "evm")).toBe(23);
    expect(fam((x) => x === "bitcoin" || x === "utxo")).toBe(18);
    expect(fam((x) => !["evm", "bitcoin", "utxo"].includes(x))).toBe(10);
    expect(broadcastSummary()).toMatch(/^51 chains\. EVM \(23\)/);
    expect(new Set(BROADCAST_CHAINS.map((c) => c.key)).size).toBe(51);
    for (const c of BROADCAST_EXTRA) for (const u of c.endpoints) expect(u).toMatch(/^https:\/\//);
  });
  it("routes core chains to txtools, extra chains here, and refuses the rest", () => {
    expect(routeBroadcast(1, chainOf)).toEqual({ core: 1 });
    expect(routeBroadcast("base", chainOf)).toEqual({ core: 8453 });
    expect(routeBroadcast(100, chainOf)).toMatchObject({ extra: { key: "100" } });
    expect(routeBroadcast("doge", chainOf)).toMatchObject({ extra: { key: "doge" } });
    expect(routeBroadcast("Bitcoin-Cash", chainOf)).toMatchObject({ extra: { key: "bch" } });
    expect(() => routeBroadcast("qtum", chainOf)).toThrow(
      /does not support chain qtum.*own wallet/,
    );
    expect(() => routeBroadcast(513100, chainOf)).toThrow(/does not support/);
  });
});

describe("EVM extra chains", () => {
  it("relays a signed tx to the chain's RPC with eth_sendRawTransaction", async () => {
    const { raw, from } = await signEvm(100);
    const m = mock(() => ({ body: { jsonrpc: "2.0", id: 1, result: `0x${"11".repeat(32)}` } }));
    const r = await broadcastExtra(m.f, {}, chain("gnosis"), raw);
    expect(r).toMatchObject({ broadcast: true, from, hash: `0x${"11".repeat(32)}` });
    expect(m.calls[0]!.url).toBe("https://gnosis-rpc.publicnode.com");
    expect(JSON.parse(String(m.calls[0]!.init.body))).toMatchObject({
      method: "eth_sendRawTransaction",
      params: [raw],
    });
  });
  it("uses RPC_URL_<id> first and falls through on network failure only", async () => {
    const { raw } = await signEvm(250);
    let n = 0;
    const m = mock((c) => {
      if (n++ === 0) throw new Error("down");
      return { body: { result: `0x${"22".repeat(32)}` } };
    });
    const r = await broadcastExtra(
      m.f,
      { RPC_URL_250: "https://example.invalid/rpc" },
      chain("250"),
      raw,
    );
    expect(r.broadcast).toBe(true);
    expect(m.calls.map((c) => c.url)).toEqual([
      "https://example.invalid/rpc",
      "https://rpcapi.fantom.network",
    ]);
  });
  it("rejects a chainId mismatch, a missing chainId, and unsigned/garbage input without any network call", async () => {
    const m = mock(() => ({ body: {} }));
    const { raw } = await signEvm(1);
    await expect(broadcastExtra(m.f, {}, chain("100"), raw)).rejects.toThrow(
      /signed for chain 1, not 100/,
    );
    const legacy = await signEvm(undefined, true);
    await expect(broadcastExtra(m.f, {}, chain("61"), legacy.raw)).rejects.toThrow(/no chainId/);
    await expect(broadcastExtra(m.f, {}, chain("61"), "0xzz")).rejects.toThrow(/hex/);
    expect(m.calls).toHaveLength(0);
  });
  it("a node rejection is final (no second endpoint)", async () => {
    const { raw } = await signEvm(100);
    const m = mock(() => ({ body: { error: { code: -32000, message: "insufficient funds" } } }));
    const r = await broadcastExtra(m.f, {}, chain("100"), raw);
    expect(r).toMatchObject({ broadcast: false });
    expect(String(r.reason)).toMatch(/node rejected: insufficient funds/);
    expect(m.calls).toHaveLength(1);
  });
  it("strict refuses (verify_tx cannot decode these chains) without sending", async () => {
    const { raw } = await signEvm(146);
    const m = mock(() => ({ body: { result: "0x" } }));
    const r = await broadcastExtra(m.f, {}, chain("sonic"), raw, true);
    expect(r).toMatchObject({ broadcast: false });
    expect(String(r.reason)).toMatch(/^strict/);
    expect(m.calls).toHaveLength(0);
  });
});

describe("UTXO forks", () => {
  it("Blockbook: POST /api/v2/sendtx/ with the raw hex", async () => {
    const m = mock(() => ({ body: { result: "aa".repeat(32) } }));
    const r = await broadcastExtra(m.f, {}, chain("doge"), UTXO_HEX);
    expect(r).toMatchObject({ broadcast: true, hash: "aa".repeat(32) });
    expect(m.calls[0]!.url).toBe("https://blockbook.doge.zelcore.io/api/v2/sendtx/");
    expect(m.calls[0]!.init.body).toBe(UTXO_HEX);
  });
  it("Blockbook error is reported as a node rejection", async () => {
    const m = mock(() => ({
      status: 400,
      body: { error: { message: "bad-txns-inputs-missingorspent" } },
    }));
    const r = await broadcastExtra(m.f, {}, chain("ltc"), UTXO_HEX);
    expect(r).toMatchObject({ broadcast: false });
    expect(String(r.reason)).toMatch(/missingorspent/);
  });
  it("Insight: POST /tx/send {rawtx}; WhatsOnChain: POST /tx/raw {txhex}", async () => {
    const i = mock(() => ({ body: { txid: "bb".repeat(32) } }));
    expect(await broadcastExtra(i.f, {}, chain("mona"), UTXO_HEX)).toMatchObject({
      broadcast: true,
    });
    expect(i.calls[0]!.url).toMatch(/insight-api-monacoin\/tx\/send$/);
    expect(JSON.parse(String(i.calls[0]!.init.body))).toEqual({ rawtx: UTXO_HEX });
    const w = mock(() => ({ body: `"${"cc".repeat(32)}"` }));
    expect(await broadcastExtra(w.f, {}, chain("bsv"), UTXO_HEX)).toMatchObject({
      broadcast: true,
      hash: "cc".repeat(32),
    });
    expect(JSON.parse(String(w.calls[0]!.init.body))).toEqual({ txhex: UTXO_HEX });
  });
  it("refuses PSBTs, non-hex and too-short input", async () => {
    const m = mock(() => ({ body: {} }));
    await expect(
      broadcastExtra(m.f, {}, chain("bch"), `70736274ff${"00".repeat(60)}`),
    ).rejects.toThrow(/PSBT/);
    await expect(broadcastExtra(m.f, {}, chain("bch"), "nothex")).rejects.toThrow(/hex/);
    await expect(broadcastExtra(m.f, {}, chain("bch"), "0200")).rejects.toThrow(/too short/);
    expect(m.calls).toHaveLength(0);
  });
  it("reports when no endpoint answers", async () => {
    const r = await broadcastExtra(down.f, {}, chain("zec"), UTXO_HEX);
    expect(r).toMatchObject({ broadcast: false });
    expect(String(r.reason)).toMatch(/no Zcash .* endpoint answered; nothing was broadcast/);
  });
});

describe("account ledgers", () => {
  it("XRP submit tx_blob", async () => {
    const m = mock(() => ({
      body: { result: { engine_result: "tesSUCCESS", accepted: true, tx_json: { hash: "AB" } } },
    }));
    expect(await broadcastExtra(m.f, {}, chain("xrp"), "1200")).toMatchObject({
      broadcast: true,
      hash: "AB",
    });
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({
      method: "submit",
      params: [{ tx_blob: "1200" }],
    });
    const bad = mock(() => ({
      body: { result: { engine_result: "temBAD_FEE", engine_result_message: "bad fee" } },
    }));
    expect(await broadcastExtra(bad.f, {}, chain("xrp"), "1200")).toMatchObject({
      broadcast: false,
    });
  });
  it("Stellar Horizon POST /transactions form tx=", async () => {
    const m = mock(() => ({ body: { hash: "h1", successful: true } }));
    expect(await broadcastExtra(m.f, {}, chain("xlm"), "AAAA")).toMatchObject({
      broadcast: true,
      hash: "h1",
    });
    expect(m.calls[0]!.url).toBe("https://horizon.stellar.org/transactions");
    expect(m.calls[0]!.init.body).toBe("tx=AAAA");
    await expect(broadcastExtra(m.f, {}, chain("xlm"), "not base64!")).rejects.toThrow(/base64/);
  });
  it("Algorand POST /v2/transactions raw bytes", async () => {
    const m = mock(() => ({ body: { txId: "T1" } }));
    expect(await broadcastExtra(m.f, {}, chain("algo"), "AQID")).toMatchObject({
      broadcast: true,
      hash: "T1",
    });
    expect(m.calls[0]!.url).toBe("https://mainnet-api.algonode.cloud/v2/transactions");
    expect([...(m.calls[0]!.init.body as Uint8Array)]).toEqual([1, 2, 3]);
  });
  it("Cosmos LCD BROADCAST_MODE_SYNC; non-zero code is a rejection", async () => {
    const m = mock(() => ({ body: { tx_response: { code: 0, txhash: "C0" } } }));
    expect(await broadcastExtra(m.f, {}, chain("atom"), "AQID")).toMatchObject({
      broadcast: true,
      hash: "C0",
    });
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({
      tx_bytes: "AQID",
      mode: "BROADCAST_MODE_SYNC",
    });
    const bad = mock(() => ({ body: { tx_response: { code: 5, raw_log: "insufficient funds" } } }));
    const r = await broadcastExtra(bad.f, {}, chain("atom"), "AQID");
    expect(r.broadcast).toBe(false);
    expect(bad.calls).toHaveLength(1);
  });
  it("Polkadot author_submitExtrinsic", async () => {
    const m = mock(() => ({ body: { jsonrpc: "2.0", id: 1, result: "0xdd" } }));
    expect(await broadcastExtra(m.f, {}, chain("dot"), "0x2804")).toMatchObject({
      broadcast: true,
      hash: "0xdd",
    });
    expect(JSON.parse(String(m.calls[0]!.init.body))).toMatchObject({
      method: "author_submitExtrinsic",
      params: ["0x2804"],
    });
    await expect(broadcastExtra(m.f, {}, chain("dot"), "2804")).rejects.toThrow(/0x-prefixed/);
  });
  it("TON sendBocReturnHash and Cardano submittx", async () => {
    const t = mock(() => ({ body: { ok: true, result: { hash: "TH" } } }));
    expect(await broadcastExtra(t.f, {}, chain("ton"), "te6c")).toMatchObject({
      broadcast: true,
      hash: "TH",
    });
    expect(t.calls[0]!.url).toBe("https://toncenter.com/api/v2/sendBocReturnHash");
    const a = mock(() => ({ status: 202, body: '"ad"' }));
    expect(await broadcastExtra(a.f, {}, chain("ada"), "84a4")).toMatchObject({
      broadcast: true,
      hash: "ad",
    });
    expect(a.calls[0]!.url).toBe("https://api.koios.rest/api/v1/submittx");
    expect(new Headers(a.calls[0]!.init.headers).get("content-type")).toBe("application/cbor");
  });
  it("non-string tx is refused", async () => {
    await expect(broadcastExtra(down.f, {}, chain("xrp"), { a: 1 })).rejects.toThrow(
      /must be a string/,
    );
  });
});

describe("core Bitcoin path", () => {
  it("refuses a PSBT and refuses under strict without sending", async () => {
    const m = mock(() => ({ body: "x" }));
    await expect(
      broadcastTx(m.f, {}, { chainId: 8253038, tx: `70736274ff${"00".repeat(60)}` }),
    ).rejects.toThrow(/PSBT/);
    const r = await broadcastTx(m.f, {}, { chainId: 8253038, tx: UTXO_HEX, strict: true });
    expect(r.broadcast).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});

describe("rate limit", () => {
  it("allows N per client per minute, then 429 with retry-after", () => {
    let t = 0;
    const lim = broadcastLimiter(2, () => t);
    expect(lim("a").ok).toBe(true);
    expect(lim("a").ok).toBe(true);
    const third = lim("a");
    expect(third.ok).toBe(false);
    expect(lim("b").ok).toBe(true);
    t = 60_000;
    expect(lim("a").ok).toBe(true);
  });
});

// --- review follow-ups (PR 36) ---
import { readFileSync } from "node:fs";
import { stringToHex, keccak256 as viemKeccak } from "viem";
import { btKeccak256 } from "./blocktools.js";
import { ALREADY_KNOWN, broadcastClientKey, MAX_REPLY_BYTES } from "./broadcastmore.js";

describe("PR 36 review follow-ups", () => {
  const evmChain = BROADCAST_EXTRA.find((c) => c.family === "evm")!;
  const signEvm = async () =>
    privateKeyToAccount(generatePrivateKey()).signTransaction({
      chainId: evmChain.chainId!,
      type: "eip1559",
      to: "0x000000000000000000000000000000000000dEaD",
      value: 0n,
      nonce: 0,
      gas: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    });

  it("btKeccak256 hashes the BYTES of a hex string (known vectors)", () => {
    expect(btKeccak256("0x")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    // keccak256 of the single byte 0x00, not of the text "0x00"
    expect(btKeccak256("0x00")).toBe(
      "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
    );
    expect(btKeccak256("0x00")).not.toBe(viemKeccak(stringToHex("0x00")));
  });

  it("EVM 'already known' is success and returns the precomputed keccak of the raw bytes", async () => {
    const raw = await signEvm();
    const { f } = mock(() => ({
      body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "already known" } },
    }));
    const r = await broadcastExtra(f, {}, evmChain, raw);
    expect(r.broadcast).toBe(true);
    expect(r.alreadyKnown).toBe(true);
    expect(r.hash).toBe(viemKeccak(raw));
  });

  it("Bitcoin-family 'txn-already-in-mempool' is success; 'txn-mempool-conflict' stays a rejection", async () => {
    const c = BROADCAST_EXTRA.find((x) => x.family === "utxo")!;
    const raw = "01".repeat(100);
    const ok = await broadcastExtra(
      mock(() => ({ status: 400, body: { error: { message: "txn-already-in-mempool" } } })).f,
      {},
      c,
      raw,
    );
    expect(ok.broadcast).toBe(true);
    expect(ok.alreadyKnown).toBe(true);
    const bad = await broadcastExtra(
      mock(() => ({ status: 400, body: { error: { message: "txn-mempool-conflict" } } })).f,
      {},
      c,
      raw,
    );
    expect(bad.broadcast).toBe(false);
    expect(String(bad.reason)).toMatch(/node rejected/);
    expect(ALREADY_KNOWN.test("known transaction: 0xabc")).toBe(true);
    expect(ALREADY_KNOWN.test("nonce too low")).toBe(false);
  });

  it("XRP tec* is reported as applied with fee charged, not as a node rejection", async () => {
    const c = BROADCAST_EXTRA.find((x) => x.family === "xrp")!;
    const { f } = mock(() => ({
      body: {
        result: {
          accepted: true,
          engine_result: "tecUNFUNDED_PAYMENT",
          engine_result_message: "Insufficient XRP balance to send.",
          tx_json: { hash: "AB".repeat(32) },
        },
      },
    }));
    const r = await broadcastExtra(f, {}, c, "12".repeat(80));
    expect(r.broadcast).toBe(true);
    expect(r.applied).toBe(true);
    expect(r.succeeded).toBe(false);
    expect(r.result).toBe("tecUNFUNDED_PAYMENT");
    expect(r.hash).toBe("AB".repeat(32));
    expect(String(r.reason)).toMatch(/fee was charged/);
    expect(String(r.reason)).not.toMatch(/node rejected/);
  });

  it("relay fetches refuse redirects and read at most 64 KB", async () => {
    const c = BROADCAST_EXTRA.find((x) => x.family === "xrp")!;
    const { f, calls } = mock(() => ({ body: "x".repeat(200_000) }));
    const r = await broadcastExtra(f, {}, c, "12".repeat(80));
    expect(r.broadcast).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.init.redirect).toBe("error");
    expect(MAX_REPLY_BYTES).toBe(65536);
  });

  it("rate-limit key ignores x-forwarded-for", () => {
    const h = (m: Record<string, string>) => (n: string) => m[n];
    expect(
      broadcastClientKey(h({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })),
    ).toBe("1.1.1.1");
    expect(broadcastClientKey(h({ "x-forwarded-for": "9.9.9.9" }), "10.0.0.5")).toBe("10.0.0.5");
    expect(broadcastClientKey(h({ "x-forwarded-for": "9.9.9.9" }))).toBe("local");
  });

  it("limiter drops expired windows and evicts only the oldest past the cap", () => {
    let t = 0;
    const lim = broadcastLimiter(1, () => t, 3);
    expect(lim("a").ok).toBe(true);
    t = 1;
    lim("b");
    t = 2;
    lim("c");
    t = 3;
    lim("d"); // cap 3: evicts only "a"
    expect(lim("b").ok).toBe(false); // b still limited (not wiped)
    expect(lim("c").ok).toBe(false);
    expect(lim("a").ok).toBe(true); // a was evicted, fresh window
    t = 70_000; // all expired
    expect(lim("b").ok).toBe(true);
  });

  it("README and docs counts match BROADCAST_COUNT", () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`to ${BROADCAST_COUNT} chains`);
    expect(broadcastSummary()).toMatch(new RegExp(`^${BROADCAST_COUNT} chains`));
  });
});
