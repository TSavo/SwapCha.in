import { CHAIN_COUNT, UTXO_CHAIN_COUNT } from "@swapchan/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_TOOLS, devToolRoutes, MAX_BODY, refuseSecrets, runDevTool } from "./devtools.js";

const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const XPRV =
  "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ALICE_HEX = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";

const post = (app: ReturnType<typeof devToolRoutes>, fn: string, body: unknown, ip = "1.2.3.4") =>
  app.request(`/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ok = (fn: string, i: unknown) => {
  const r = runDevTool(fn, i);
  if (!r.ok) throw new Error(`${fn}: ${r.error_code}`);
  return r.result as Record<string, unknown>;
};

describe("dev tools (blocktools, public input only)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("address detect / validate / convert / cashaddr / script", () => {
    expect(
      ok("detect-address", { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }).chains,
    ).toContainEqual({
      chain: "btc",
      kind: "P2pkh",
    });
    expect(
      ok("validate-address", { chain: "btc", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb" }).valid,
    ).toBe(false);
    expect(
      ok("validate-address", { chain: "btc", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }),
    ).toMatchObject({
      valid: true,
      kind: "P2pkh",
    });
    expect(
      runDevTool("convert-address", { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", to: "eth" }),
    ).toMatchObject({
      ok: false,
      error_code: "no_equivalent",
    });
    expect(
      ok("cashaddr", {
        op: "to_legacy",
        address: "bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy",
      }).legacy,
    ).toBe("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(
      ok("address-script", {
        op: "to_script",
        chain: "btc",
        address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      }).script,
    ).toBe("76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac");
    // Zcash t1 (2-byte version) and uppercase bech32 give the same script as the BTC form of the same hash
    const P2PKH = "76a91477bff20c60e522dfaa3350c39b030a5d004e839a88ac";
    expect(
      ok("address-script", {
        op: "to_script",
        chain: "btc",
        address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      }).script,
    ).toBe(P2PKH);
    expect(
      ok("address-script", {
        op: "to_script",
        chain: "zec",
        address: "t1UnnMmegrDJFVUW9iVz2CaABWLK2ztsf3X",
      }).script,
    ).toBe(P2PKH);
    expect(ok("address-script", { op: "from_script", chain: "zec", script: P2PKH })).toMatchObject({
      address: "t1UnnMmegrDJFVUW9iVz2CaABWLK2ztsf3X",
    });
    const W = "0014751e76e8199196d454941c45d1b3a323f1433bd6";
    expect(
      ok("address-script", {
        op: "to_script",
        chain: "btc",
        address: "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
      }).script,
    ).toBe(W);
    expect(
      ok("address-script", {
        op: "to_script",
        chain: "btc",
        address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      }).script,
    ).toBe(W);
    expect(
      runDevTool("address-script", { op: "to_script", chain: "zec", address: "t1abc" }),
    ).toMatchObject({ ok: false });
  });

  it("xpub addresses (BIP32 vector 1, m/0/0)", () => {
    const r = ok("xpub-addresses", { chain: "btc", xpub: XPUB, count: 2 });
    expect((r.addresses as { address: string }[]).map((a) => a.address)).toEqual([
      "12CL4K2eVqj7hQTix7dM7CVHCkpP17Pry3",
      "13Q3u97PKtyERBpXg31MLoJbQsECgJiMMw",
    ]);
    expect(runDevTool("xpub-addresses", { chain: "btc", xpub: XPUB, count: 21 })).toMatchObject({
      ok: false,
      error_code: "bad_count",
    });
  });

  it("xprv rejected (and other secret-looking input), before blocktools is called", () => {
    for (const [fn, body] of [
      ["xpub-addresses", { chain: "btc", xpub: XPRV }],
      ["detect-address", { address: XPRV }],
      ["xpub-addresses", { chain: "btc", xpub: XPRV.replace(/^x/, "z") }],
      ["detect-address", { address: "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ" }],
      ["detect-address", { address: "abandon ".repeat(11) + "about" }],
      ["detect-address", { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", privateKey: "x" }],
      ["detect-address", { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", mnemonic: "x" }],
      ["detect-address", { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", seed: "x" }],
    ] as const)
      expect(runDevTool(fn, body)).toMatchObject({ ok: false, error_code: "secret_input_refused" });
    expect(() => refuseSecrets({ a: [{ b: XPRV }] })).toThrow("secret_input_refused");
  });

  it("ss58, storage key, solana, hashes, chain params", () => {
    expect(ok("ss58", { op: "decode", address: ALICE })).toEqual({
      prefix: 42,
      account: ALICE_HEX,
    });
    expect(ok("ss58", { op: "encode", account: ALICE_HEX, prefix: 0 }).address).toBe(
      "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5",
    );
    expect(ok("polkadot-storage-key", { account: ALICE }).key).toMatch(
      /^0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9/,
    );
    expect(
      ok("solana-ata", {
        owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      }).address,
    ).toBe("FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B");
    expect(
      ok("solana-pda", {
        seeds: ["6d65746164617461"],
        program: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      }),
    ).toMatchObject({ bump: 253 });
    expect(ok("anchor-discriminator", { name: "initialize" }).discriminator).toBe(
      "afaf6d1f0d989bed",
    );
    expect(ok("blake2b", { data: "616263" }).hash).toBe(
      "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
    );
    expect(ok("twox128", { text: "System" }).hash).toBe("26aa394eea5630e07c48ae0c9558cef7");
    // displayed counts come from @swapchan/shared CHAIN_TABLE (asserted in blocktools.chaintable.test.ts)
    expect(ok("chain-params", {}).count).toBe(CHAIN_COUNT);
    const rows = ok("chain-params", {}).chains as { p2pkh: number[] | null }[];
    expect(rows.filter((r) => (r.p2pkh?.length ?? 0) > 0).length).toBe(UTXO_CHAIN_COUNT);
    expect(ok("chain-params", { chain: "btc" })).toMatchObject({ ticker: "BTC" });
  });

  it("no signing, recovery, raw-tx or secret functionality is exposed", () => {
    for (const k of Object.keys(DEV_TOOLS))
      expect(k).not.toMatch(
        /sign|sweep|recover|seed|key(?!$)|keystore|decode-tx|verify|psbt|wif|derive-priv/,
      );
    expect(runDevTool("buildUnsignedSweep", {})).toMatchObject({
      ok: false,
      error_code: "unknown_tool",
    });
  });

  it("never logs request bodies (success, error and refused paths)", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const app = devToolRoutes({ perMinute: 1000 });
    const MARK = "5Fmarker000000000000000000000000000000000000";
    await post(app, "detect-address", { address: MARK });
    await post(app, "ss58", { op: "decode", address: MARK });
    await post(app, "xpub-addresses", { chain: "btc", xpub: XPRV, note: MARK });
    await post(app, "nope", { address: MARK });
    await post(app, "detect-address", `{"address":"${MARK}"`);
    const res = await post(app, "ss58", { op: "decode", address: MARK });
    expect(await res.text()).not.toContain(MARK); // errors never echo input
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(MARK);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("size cap, bad json, unknown tool", async () => {
    const app = devToolRoutes({ perMinute: 1000 });
    expect((await post(app, "twox128", { text: "a".repeat(MAX_BODY) })).status).toBe(413);
    expect((await post(app, "twox128", "{")).status).toBe(400);
    expect((await post(app, "nope", {})).status).toBe(404);
    const r = await post(app, "twox128", { text: "System" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("rate limits per client, per 60s window", async () => {
    let t = 0;
    const app = devToolRoutes({ perMinute: 3, now: () => t });
    for (let n = 0; n < 3; n++)
      expect((await post(app, "twox128", { text: "a" })).status).toBe(200);
    const r = await post(app, "twox128", { text: "a" });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect((await post(app, "twox128", { text: "a" }, "5.6.7.8")).status).toBe(200);
    t = 60_000;
    expect((await post(app, "twox128", { text: "a" })).status).toBe(200);
  });
});
