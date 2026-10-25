import { createHash } from "node:crypto";
import { base58, base58xrp, bech32 } from "@scure/base";

/** Deterministic address corpora (sha256 chain) for the CashAddr / XRP / Solana-key parity tests. */
const h = (s: string) => new Uint8Array(createHash("sha256").update(s).digest());
const sha = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const ck = (enc: (b: Uint8Array) => string, b: Uint8Array) =>
  enc(Uint8Array.from([...b, ...sha(sha(b)).slice(0, 4)]));
const flipLast = (a: string, x: string, y: string) => a.slice(0, -1) + (a.at(-1) === x ? y : x);

/** BCH CashAddr strings built from legacy hashes (encoded independently with the CashAddr polymod in the test),
 *  plus case, prefix, checksum and length mutations. */
export const cashCorpus = (
  encode: (kind: "p2pkh" | "p2sh", hashHex: string) => string,
): string[] => {
  const good: string[] = [];
  for (let i = 0; i < 300; i++) {
    const x = Buffer.from(h(`c${i}`).slice(0, 20)).toString("hex");
    good.push(encode("p2pkh", x), encode("p2sh", x));
  }
  good.push(
    "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
    "ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq",
  );
  const bad = good.slice(0, 300).flatMap((c) => {
    const b = c.replace(/^bitcoincash:/, "");
    return [
      b,
      c.toUpperCase(),
      b.toUpperCase(),
      flipLast(c, "q", "p"),
      c.replace("bitcoincash:", "bchtest:"),
      c[0] + c.slice(1).toUpperCase(),
      `${c}q`,
    ];
  });
  return [...good, ...bad, "", "bitcoincash:", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"];
};
/** Classic XRP r-addresses (valid), wrong version/length payloads with valid checksums, and mutations. */
export const xrpCorpus = (): string[] => {
  const xs: string[] = [];
  for (let i = 0; i < 500; i++)
    xs.push(ck(base58xrp.encode, Uint8Array.from([0, ...h(`x${i}`).slice(0, 20)])));
  for (let i = 0; i < 100; i++)
    xs.push(
      ck(
        base58xrp.encode,
        Uint8Array.from([i % 3 === 0 ? 1 : 0, ...h(`y${i}`).slice(0, 19 + (i % 3))]),
      ),
    );
  const m = xs
    .slice(0, 300)
    .flatMap((a) => [flipLast(a, "r", "p"), a.slice(0, 10) + a.slice(11), `${a}r`]);
  return [
    ...xs,
    ...m,
    "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLi",
    "rrrrrrrrrrrrrrrrrrrrrhoLvTp",
    "rrrrrrrrrrrrrrrrrrrrBZbvji",
    "rrrrrrrrrrrrrrrrrNAMEtGFn",
    "XVLhHMPHU98es4dbozjVtdWzVrDjtV5fdx1mHp98tDMoQXb",
    "So11111111111111111111111111111111111111112",
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    "",
  ];
};
/** 32-byte keys (Solana) plus 31/33/34-byte and other-chain base58 strings that also match the charset. */
export const svmCorpus = (): string[] => {
  const s: string[] = [];
  for (let i = 0; i < 500; i++) s.push(base58.encode(h(`s${i}`)));
  for (let i = 0; i < 50; i++)
    s.push(
      base58.encode(Uint8Array.from([0, 0, ...h(`z${i}`).slice(0, 30)])),
      base58.encode(h(`q${i}`).slice(0, 31)),
      base58.encode(Uint8Array.from([...h(`u${i}`), 1])),
      ck(base58.encode, Uint8Array.from([0, ...h(`b${i}`).slice(0, 20)])),
      ck(base58.encode, Uint8Array.from([0x41, ...h(`t${i}`).slice(0, 20)])),
    );
  return [
    ...s,
    ...xrpCorpus().slice(0, 50),
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "",
    "11111111111111111111111111111111",
  ];
};

/** Per-coin output-script corpus: base58check p2pkh/p2sh from the coin's version bytes, bech32 v0 (lower, UPPER,
 *  Mixed), and rejections (bad checksum, wrong version, wrong HRP, truncated, v1). Deterministic. */
export const scriptCorpus = (
  coins: [string, { p2pkh: number[]; p2sh: number[]; hrp?: string | null; checksum?: string }][],
): [string, string][] => {
  const b58c = (b: Uint8Array) => {
    const c = sha(sha(b)).slice(0, 4);
    return base58.encode(Uint8Array.from([...b, ...c]));
  };
  const out: [string, string][] = [];
  for (const [k, c] of coins) {
    for (let i = 0; i < 12; i++) {
      const hh = h(`os-${k}-${i}`).slice(0, 20);
      const h32 = h(`os32-${k}-${i}`);
      if (c.checksum !== "groestl") {
        const pk = b58c(Uint8Array.from([...c.p2pkh, ...hh]));
        const sh = b58c(Uint8Array.from([...c.p2sh, ...hh]));
        out.push([k, pk], [k, sh], [k, flipLast(pk, "a", "b")], [k, pk.slice(0, -2)]);
        out.push([k, b58c(Uint8Array.from([0x7f, ...hh]))]);
      }
      if (c.hrp) {
        const a = bech32.encode(c.hrp, [0, ...bech32.toWords(hh)]);
        const w = bech32.encode(c.hrp, [0, ...bech32.toWords(h32)]);
        out.push([k, a], [k, w], [k, a.toUpperCase()], [k, w.toUpperCase()]);
        out.push([k, a.slice(0, -3) + a.slice(-3).toUpperCase()]);
        out.push([k, bech32.encode("zz", [0, ...bech32.toWords(hh)])]);
        out.push([k, flipLast(a, "q", "p")]);
        out.push([k, bech32.encode(c.hrp, [1, ...bech32.toWords(h32)])]);
      }
    }
  }
  return out;
};
