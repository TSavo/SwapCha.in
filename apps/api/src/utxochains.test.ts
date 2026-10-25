import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { FORK_SIGN_GUIDE, forkSweep } from "./ethforks.js";
import { prevUtxos, withPrev } from "./testkit/prevfix.js";
import { coinOf, convert, decodeAny, outputScript, SIGN_GUIDE, utxoSweep } from "./utxochains.js";

const BTC = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
describe("bitcoin-family address conversion", () => {
  it("maps one key to every coin's address", () => {
    expect(convert(BTC, "btg")).toBe("GUm6mZZVrk7wyJkYi1q1VXQAAquoGD4bcP");
    expect(convert(BTC, "ltc")).toBe("LW98ceYNxYki9e9QxDACLn82TtVEPm4qmy");
    expect(convert("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "ltc")).toBe(
      "ltc1qar0srrr7xfkvy5l643lydnw9re59gtzz24wl4s",
    );
    expect(convert("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "doge")).toBeNull();
    expect(coinOf(convert(BTC, "doge")!)).toBe("doge");
    expect(coinOf(BTC)).toBeNull();
  });
  it("rejects bad checksums (so Solana keys are not read as BTC)", () => {
    expect(decodeAny("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3")).toBeNull();
    expect(decodeAny("So11111111111111111111111111111111111111112")).toBeNull();
  });
  it("builds an unsigned sweep of every UTXO to the destination", async () => {
    const L = "LW98ceYNxYki9e9QxDACLn82TtVEPm4qmy";
    const a1 = prevUtxos("ltc", L, ["100000"], 1, 1);
    const a2 = prevUtxos("ltc", L, ["50000"], 0, 2);
    const f = withPrev(
      new Map([...a1.prev, ...a2.prev]),
      () => new Response(JSON.stringify([...a1.utxos, ...a2.utxos])),
    );
    const s = await utxoSweep(
      f,
      "ltc",
      "LW98ceYNxYki9e9QxDACLn82TtVEPm4qmy",
      "LW98ceYNxYki9e9QxDACLn82TtVEPm4qmy",
      1,
    );
    const tx = Transaction.fromHex(s.unsignedTx);
    expect(tx.ins.length).toBe(2);
    expect(tx.outs.length).toBe(1);
    expect(
      Buffer.from(tx.outs[0]!.script).equals(
        outputScript("LW98ceYNxYki9e9QxDACLn82TtVEPm4qmy", "ltc"),
      ),
    ).toBe(true);
    expect(BigInt(tx.outs[0]!.value) + BigInt(s.fee)).toBe(150000n);
    await expect(utxoSweep(f, "ltc", "x", BTC)).rejects.toThrow(/LTC address/);
  });
  it("signing guidance warns about replay and keys", () => {
    expect(SIGN_GUIDE("bch")).toMatch(/FORKID/);
    expect(SIGN_GUIDE("ltc")).toMatch(/never type a seed/);
    expect(FORK_SIGN_GUIDE("etc")).toMatch(/chainId 61/);
  });
  it("fork sweep is EIP-155 and leaves gas", async () => {
    const f = (async (_u: string, i: RequestInit) => {
      const m = JSON.parse(String(i.body)).method;
      return new Response(
        JSON.stringify({
          result:
            m === "eth_getBalance"
              ? "0xde0b6b3a7640000"
              : m === "eth_gasPrice"
                ? "0x3b9aca00"
                : "0x5",
        }),
      );
    }) as unknown as typeof fetch;
    const r = await forkSweep(f, "etc", "0x" + "11".repeat(20), "0x" + "22".repeat(20));
    expect(r.tx.chainId).toBe(61);
    expect(BigInt(r.tx.value) + 21000n * BigInt(r.tx.gasPrice)).toBe(10n ** 18n);
    expect(r.tx.nonce).toBe("5");
  });
});

import { recoveryGuide } from "./keyrecovery.js";

describe("recovery_guide additions", () => {
  it("lists LTC/DOGE/BCH/BTG paths, Exodus, uncompressed keys and Electrum pointers", () => {
    const g = recoveryGuide("full") as {
      derivationPaths: { path: string; wallet: string; chain: string }[];
      uncompressedKeys: { rule: string };
      situations: { id: string; pointers?: string[] }[];
    };
    const paths = g.derivationPaths.map((p) => p.path);
    for (const p of [
      "m/44'/2'/0'/0/{i}",
      "m/84'/2'/0'/0/{i}",
      "m/44'/3'/0'/0/{i}",
      "m/44'/145'/0'/0/{i}",
      "m/44'/156'/0'/0/{i}",
    ])
      expect(paths).toContain(p);
    expect(g.derivationPaths.some((p) => /Exodus/.test(p.wallet) && p.chain === "multi")).toBe(
      true,
    );
    expect(g.uncompressedKeys.rule).toMatch(/uncompressed/);
    expect(g.situations.find((s) => s.id === "electrum")?.pointers?.length).toBeGreaterThan(1);
  });
});

import { fomoClaimable, IRONHANDS, ironHandsPayNow, verifyClaimTx } from "./intel";

describe("legacy: Fomo3D not-claimable + IronHands queue", () => {
  it("fomo withdraw pays only when the call succeeds and the contract covers the vaults", () => {
    expect(fomoClaimable(10n, 100n, true)).toBe(true);
    expect(fomoClaimable(10n, 5n, true)).toBe(false);
    expect(fomoClaimable(10n, 100n, false)).toBe(false);
    expect(fomoClaimable(0n, 100n, true)).toBe(false);
  });
  it("ironhands pays half the balance capped at the head's payout, only to the head", () => {
    const me = "0x00000000000000000000000000000000000000aa";
    expect(ironHandsPayNow(me, [me, 10n ** 18n], 4n * 10n ** 17n)).toBe(2n * 10n ** 17n);
    expect(ironHandsPayNow(me, [me, 10n ** 16n], 10n ** 18n)).toBe(10n ** 16n);
    expect(
      ironHandsPayNow(me, ["0x00000000000000000000000000000000000000bb", 1n], 10n ** 18n),
    ).toBe(0n);
    expect(ironHandsPayNow(me, null, 10n ** 18n)).toBe(0n);
  });
  it("payout() on IronHands is allowlisted with zero value", () => {
    expect(verifyClaimTx({ to: IRONHANDS, data: "0x63bd1d4a", value: "0" }).verified).toBe(true);
    expect(verifyClaimTx({ to: IRONHANDS, data: "0x63bd1d4a", value: "1" }).verified).toBe(false);
  });
});

import { recoveryFlow } from "./recover";

describe("sweep items get a /recover sweep page, never an external link", () => {
  it("utxo item: recover step to swapchan.com/recover?sweep=utxo, no fake swap link", () => {
    const r = recoveryFlow(null, null, "x", {
      title: "Dogecoin: 1 DOGE",
      swapUrl: "https://swapchan.com/?fromChain=0&toChain=0",
      sweep: { kind: "utxo", coin: "doge", from: "DAddr", sym: "DOGE" },
    } as never) as { steps: { kind: string; url: string }[]; recoverUrl: string; swapUrl?: string };
    expect(r.recoverUrl).toMatch(
      /^https:\/\/swapchan\.com\/recover\?sweep=utxo&coin=doge&from=DAddr/,
    );
    expect(r.steps.map((s) => s.kind)).toEqual(["recover"]);
    expect(r.swapUrl).toBe(r.recoverUrl);
  });
});

import { verifyRecovery } from "./recover";

describe("IronHands payout() is a verified recovery only on the IronHands contract", () => {
  it("pins the contract", () => {
    expect(
      verifyRecovery(
        { to: "0xe58b65d1c0c8e8b2a0e3a3acec633271531084ed", data: "0x63bd1d4a", value: "0" },
        "0x1",
      ).verified,
    ).toBe(true);
    expect(
      verifyRecovery(
        { to: "0x0000000000000000000000000000000000000001", data: "0x63bd1d4a", value: "0" },
        "0x1",
      ).verified,
    ).toBe(false);
  });
});

import { coinPrices } from "./utxochains.js";

describe("coin prices", () => {
  it("falls back to CoinPaprika when DefiLlama and CoinGecko have no BTG price", async () => {
    const f = (async (u: string) =>
      new Response(
        JSON.stringify(
          u.includes("coinpaprika")
            ? { quotes: { USD: { price: 0.5 } } }
            : u.includes("llama")
              ? { coins: {} }
              : {},
        ),
      )) as unknown as typeof fetch;
    expect((await coinPrices(f, ["bitcoin-gold"]))["bitcoin-gold"]).toBe(0.5);
  });
});
