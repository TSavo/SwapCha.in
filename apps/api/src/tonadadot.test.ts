import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adaScan,
  blake2b,
  decodeAccountInfo,
  dotScan,
  ss58PublicKey,
  systemAccountKey,
  tonScan,
} from "./ledgers2.js";

const TON = "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N";
const ADA =
  "addr1qy2jt0qpqz2z2z9zx5w4xemekkce7yderz53kjue53lpqv90lkfa9sgrfjuz6uvt4uqtrqhl2kj0a9lnr9ndzutx32gqleeckv";
const DOT = "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const px = (u: string) =>
  u.includes("coins.llama.fi")
    ? json({
        coins: {
          "coingecko:the-open-network": { price: 2 },
          "coingecko:cardano": { price: 0.5 },
          "coingecko:polkadot": { price: 4 },
        },
      })
    : null;
const down = (async (u: string) => px(u) ?? json({}, 503)) as unknown as typeof fetch;
const le128 = (v: bigint) =>
  Buffer.from(Array.from({ length: 16 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn)));
const accountInfo = (free: bigint, reserved: bigint, frozen: bigint) =>
  `0x${Buffer.concat([Buffer.alloc(16), le128(free), le128(reserved), le128(frozen), le128(0n)]).toString("hex")}`;

describe("TON", () => {
  it("toncenter rate-limited (429) → tonapi fallback; Spendable balance", async () => {
    const hit: string[] = [];
    const f = (async (u: string) => {
      hit.push(u);
      return (
        px(u) ??
        (u.includes("toncenter")
          ? json({ ok: false }, 429)
          : json({ balance: 12_500_000_000, status: "active" }))
      );
    }) as unknown as typeof fetch;
    const r = await tonScan(f, TON);
    expect(hit.filter((u) => u.includes("toncenter"))).toHaveLength(1);
    expect(r.items[0]!.kind).toBe("balance");
    expect(r.items[0]!.what).toMatch(/^12\.5 TON spendable/);
    expect(r.items[0]!.valueUsd).toBe(25);
  });
  it("frozen account → lead, not counted; all endpoints down → not checked", async () => {
    const f = (async (u: string) =>
      px(u) ??
      (u.includes("toncenter")
        ? json({}, 500)
        : json({ balance: "5", status: "frozen" }))) as unknown as typeof fetch;
    const r = await tonScan(f, TON);
    expect(r.items[0]!.kind).toBe("lead");
    expect(r.items[0]!.valueUsd).toBeNull();
    expect((await tonScan(down, TON)).notChecked[0]).toMatch(
      /^TON \(toncenter\/tonapi\): not checked/,
    );
  });
});

describe("Cardano (Koios)", () => {
  it("address ADA spendable, rewards claimable, other addresses and key deposit as leads", async () => {
    const f = (async (u: string, init?: RequestInit) => {
      const p = px(u);
      if (p) return p;
      if (u.endsWith("/address_info"))
        return json([
          {
            balance: "183660195",
            stake_address: "stake1x",
            utxo_set: [{ asset_list: [{}] }, { asset_list: [] }],
          },
        ]);
      if (u.endsWith("/account_info")) {
        expect(JSON.parse(String(init?.body))._stake_addresses).toEqual(["stake1x"]);
        return json([
          {
            status: "registered",
            delegated_pool: "pool1abc",
            total_balance: "263918952",
            utxo: "253660195",
            rewards_available: "10258757",
            deposit: "2000000",
          },
        ]);
      }
      return json({}, 404);
    }) as unknown as typeof fetch;
    const r = await adaScan(f, ADA);
    const by = Object.fromEntries(r.items.map((i) => [i.protocol, i]));
    expect(by.Cardano!.kind).toBe("balance");
    expect(by.Cardano!.what).toMatch(
      /^183\.660195 ADA spendable.*1 UTXO\(s\) also hold native tokens.*min-UTXO.*pool1abc/,
    );
    expect(by.Cardano!.valueUsd).toBe(91.83);
    expect(by["Cardano staking rewards"]!.kind).toBe("claimable");
    expect(by["Cardano staking rewards"]!.what).toMatch(/^10\.258757 ADA/);
    expect(by["Cardano same wallet"]!.what).toMatch(/^70 more ADA/);
    expect(by["Cardano stake key deposit"]!.kind).toBe("lead");
  });
  it("Koios down → not checked", async () => {
    const r = await adaScan(down, ADA);
    expect(r.items).toEqual([]);
    expect(r.notChecked[0]).toMatch(/^Cardano \(Koios\): not checked/);
  });
});

describe("Polkadot", () => {
  it("blake2b matches node's blake2b512; SS58 + System.Account key + SCALE decode", () => {
    const d = new Uint8Array(200).map((_, i) => i);
    expect(Buffer.from(blake2b(d, 64)).equals(createHash("blake2b512").update(d).digest())).toBe(
      true,
    );
    expect(systemAccountKey(ss58PublicKey(DOT))).toBe(
      "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da95ecffd7b6c0f78751baa9d281e0bfa3a6d6f646c70792f74727372790000000000000000000000000000000000000000",
    );
    expect(() => ss58PublicKey("13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTC")).toThrow();
    expect(decodeAccountInfo(accountInfo(5n, 6n, 7n))).toEqual({
      free: 5n,
      reserved: 6n,
      frozen: 7n,
    });
    expect(decodeAccountInfo(null)).toEqual({ free: 0n, reserved: 0n, frozen: 0n });
  });
  it("Asset Hub sidecar down → RPC fallback; frozen part is a lead; relay via sidecar", async () => {
    const f = (async (u: string) => {
      const p = px(u);
      if (p) return p;
      if (u.includes("asset-hub-public-sidecar")) return json({ code: 500 }, 500);
      if (u.includes("polkadot-public-sidecar"))
        return json({ free: "30000000000", reserved: "0", frozen: "0" });
      if (u.includes("asset-hub-rpc.polkadot.io"))
        return json({
          jsonrpc: "2.0",
          id: 1,
          result: accountInfo(1_000_000_000_000n, 0n, 400_000_000_000n),
        });
      return json({}, 503);
    }) as unknown as typeof fetch;
    const r = await dotScan(f, DOT);
    expect(r.notChecked).toEqual([]);
    const by = Object.fromEntries(r.items.map((i) => [i.protocol, i]));
    expect(by["Polkadot Asset Hub"]!.what).toMatch(
      /^60 DOT spendable on Polkadot Asset Hub.*0\.01 DOT existential deposit/,
    );
    expect(by["Polkadot Asset Hub"]!.valueUsd).toBe(240);
    expect(by["Polkadot Asset Hub locked"]!.kind).toBe("lead");
    expect(by["Polkadot Asset Hub locked"]!.what).toMatch(/^40 DOT locked/);
    expect(by["Polkadot relay chain"]!.what).toMatch(
      /^3 DOT spendable on Polkadot relay chain.*1 DOT existential deposit/,
    );
  });
  it("every endpoint down → a not-checked line per chain", async () => {
    const r = await dotScan(down, DOT);
    expect(r.items).toEqual([]);
    expect(r.notChecked).toHaveLength(2);
    expect(r.notChecked[0]).toMatch(/^Polkadot Asset Hub \(sidecar\/RPC\): not checked/);
    expect(r.notChecked[1]).toMatch(/^Polkadot relay chain \(sidecar\/RPC\): not checked/);
  });
});
