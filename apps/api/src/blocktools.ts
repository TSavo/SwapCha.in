import { createRequire } from "node:module";

/**
 * TSavo/blocktools public API (WASM, default features: no secrets/signing), vendored in ../vendor/blocktools
 * (see vendor/blocktools/SOURCE). Loaded once; if it fails to load, the try-helpers return null and the need()
 * helpers (Polkadot, Solana, ...) throw, so callers fail closed rather than fall back to unverified TS.
 */
type Wasm = {
  version(): string;
  supportedChains(): string;
  unverifiedChains(): string;
  chainParams(): string;
  chainTable(): string;
  detectAddress(addr: string): string;
  decodeTx(input: string, chain: string): string;
  verifyTx(
    input: string,
    chain: string,
    expectTo: string[],
    change: string[],
    chainId: number | null | undefined,
    maxFee: string,
    allowWarnings: boolean,
    /** 8dfbe68: nonzero ETH value beside ERC-20 transfer calldata fails (eth_value_with_token_call) unless true */
    allowValueWithToken?: boolean | null,
  ): string;
  convertAddress(addr: string, to: string): string;
  convertAddressFrom(from: string, addr: string, to: string): string;
  addressValidate(chain: string, addr: string): string;
  buildUnsignedSweep(chain: string, utxos: string, to: string, feeRate: number): string;
  buildUnsignedSweepAt(
    chain: string,
    utxos: string,
    to: string,
    feeRate: number,
    time: number,
  ): string;
  decodeTx(input: string, chain: string): string;
  blake2b(dataHex: string, outLen: number, personal: string): string;
  twox128(text: string): string;
  ss58Encode(accountHex: string, prefix: number): string;
  ss58Decode(addr: string): string;
  polkadotAccountStorageKey(account: string): string;
  decodeAccountInfo(hex: string): string;
  base58Encode(hex: string): string;
  base58Decode(s: string): string;
  solIsOnCurve(addr: string): boolean;
  solFindProgramAddress(seedsJson: string, program: string): string;
  solAssociatedTokenAddress(owner: string, mint: string, tokenProgram: string): string;
  solAnchorDiscriminator(name: string): string;
  solDecodeTx(raw: string): string;
  solVerifyTx(raw: string, expectJson: string): string;
  cashAddrDecode(addr: string): string;
  cashAddrEncode(prefix: string, kind: string, hashHex: string): string;
  cashAddrToLegacy(addr: string): string;
  legacyToCashAddr(addr: string, prefix: string): string;
  addressToScript(chain: string, addr: string): string;
  scriptToAddress(chain: string, scriptHex: string): string;
  buildPsbtWithMemo(
    chain: string,
    utxos: string,
    to: string,
    amount: string,
    change: string,
    feeRate: number,
    memoHex: string,
    rbf?: boolean | null,
  ): string;
  tronTxId(rawDataHex: string): string;
  serializeNvcTxFromJson(json: string, expectedTxid: string): string;
  verifyRecovery(txJson: string, owner: string, nowS: number): string;
  verifySweepTx(txJson: string, owner: string, chainId: number, token: string): string;
  tronDecodeTx(hex: string): string;
  addressesFromXpub(
    xpub: string,
    chain: string,
    kinds: string[],
    branches: Uint32Array,
    indices: Uint32Array,
  ): string;
};
export type BtParams = {
  name: string;
  ticker: string;
  verified: boolean;
  p2pkh: number[] | null;
  p2sh: number[] | null;
  hrp: string | null;
  decimals: number;
  forkid: number | null;
  tx_format: string;
  sweep_build: boolean;
  /** per-coin verifyTx warning limits (d4e4ea8); basis starts with "default" when not measured for this coin */
  fee_warn?: { fee: number; rate: number; basis: string };
};
/**
 * blocktools (7b70ba4+) emits a decimal-string twin `amount_str` / `fee_str` beside every integer `amount` / `fee`
 * (any depth) because JSON.parse rounds integers above 2^53 (RDD: 33,979,404,789,171,950 units). This parses the
 * output and replaces each `amount` / `fee` with its exact twin; a missing twin throws (fail closed). This replaced
 * SwapChan's own regex quoting (bigJson) of 16+ digit integer tokens.
 */
export function exactJson<T>(raw: string): T {
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["amount", "fee"])
        if (k in o && (typeof o[k] === "number" || typeof o[k] === "string")) {
          const t = o[`${k}_str`];
          if (typeof t !== "string" || !/^\d+$/.test(t))
            throw new Error(`blocktools output has ${k} without ${k}_str`);
          o[k] = t;
        }
      for (const k of Object.keys(o)) o[k] = fix(o[k]);
    }
    return v;
  };
  return fix(JSON.parse(raw)) as T;
}
let wasm: Wasm | null | undefined;
export function blocktools(): Wasm | null {
  if (wasm !== undefined) return wasm;
  try {
    const req = createRequire(import.meta.url);
    wasm = req(
      new URL("../vendor/blocktools/blocktools_wasm.js", import.meta.url).pathname,
    ) as Wasm;
    wasm.version();
  } catch (e) {
    console.log(JSON.stringify({ evt: "blocktools_load_failed", err: String(e).slice(0, 200) }));
    wasm = null;
  }
  return wasm;
}
const tryRun = <T>(fn: (w: Wasm) => T): T | null => {
  const w = blocktools();
  if (!w) return null;
  try {
    return fn(w);
  } catch {
    return null;
  }
};
export const btVersion = () => tryRun((w) => w.version());
export const btParams = (): Map<string, BtParams> | null =>
  tryRun((w) => new Map((JSON.parse(w.chainParams()) as BtParams[]).map((p) => [p.name, p])));
/** Every chain the address is valid on (never picks one); [] = unrecognised; null = WASM unavailable. */
export const btDetect = (addr: string): string[] | null =>
  blocktools()
    ? (tryRun((w) =>
        (JSON.parse(w.detectAddress(addr)) as { chain: string }[]).map((x) => x.chain),
      ) ?? [])
    : null;
/** Address kind if valid on `chain`, else null. */
export const btValidate = (chain: string, addr: string) =>
  tryRun((w) => w.addressValidate(chain, addr));
export const btConvertFrom = (from: string, addr: string, to: string) =>
  tryRun((w) => w.convertAddressFrom(from, addr, to));
export type BtSweep = {
  chain: string;
  tx_format: string;
  /** absent for pos-ntime (no PSBT exists for that format) */
  psbt?: string;
  unsigned_tx: string;
  /** pos-ntime: the tx timestamp and the prevouts verifyTx/decodeTx need for amounts */
  time?: number;
  pos_prevouts?: { amount: string; amount_str: string; script: string }[];
  /** zcash-v5: consensus branch id (hex), expiry height and the prevouts (ZIP-244 commits to amounts) */
  branch_id?: string;
  expiry_height?: number;
  zec_prevouts?: { amount: string; amount_str: string; script: string }[];
  /** the raw JSON line blocktools returned (decode/verify input for pos-ntime) */
  envelope?: string;
  inputs: unknown[];
  /** exact decimal strings (from amount_str / fee_str) */
  amount: string;
  fee: string;
};
/** Throws blocktools' error (e.g. unsupported_tx_format:pos-ntime); returns null only when the WASM is unavailable. */
export function btSweep(
  chain: string,
  /** prev_tx: raw previous tx hex, required by blocktools for legacy (P2PKH), bare P2SH (2052b30) and every pos-ntime input */
  utxos: {
    txid: string;
    vout: number;
    amount: number | string;
    address: string;
    prev_tx?: string | undefined;
  }[],
  to: string,
  feeRate: number,
  /** unix seconds; when set, builds with buildUnsignedSweepAt (required by pos-ntime chains ppc/nvc/clam/rdd) */
  time?: number,
): BtSweep | null {
  const w = blocktools();
  if (!w) return null;
  // amount as a decimal string (accepted since 7b70ba4; per-UTXO limit 2^63-1), never a rounded Number
  const lines = utxos
    .map((u) =>
      JSON.stringify({
        txid: u.txid,
        vout: u.vout,
        amount: BigInt(u.amount).toString(),
        address: u.address,
        ...(u.prev_tx ? { prev_tx: u.prev_tx } : {}),
      }),
    )
    .join("\n");
  const raw =
    time === undefined
      ? w.buildUnsignedSweep(chain, lines, to, feeRate)
      : w.buildUnsignedSweepAt(chain, lines, to, feeRate, time);
  return { ...exactJson<BtSweep>(raw), envelope: raw };
}

export type BtDecoded = {
  role: string;
  /** exact decimal string (from fee_str) */
  fee?: string;
  inputs?: number;
  outputs?: number;
  txid?: string;
  address?: string;
  /** exact decimal string (from amount_str) */
  amount?: string;
}[];
/** decodeTx lines (summary, inputs, outputs) for a built tx/PSBT. Throws on a decode error. */
export function btDecode(tx: string, chain: string): BtDecoded | null {
  const w = blocktools();
  return w ? exactJson<BtDecoded>(w.decodeTx(tx, chain)) : null;
}
/** verifyTx: every output pays `to`, fee is known and at most `maxFee` (decimal base units). The "unsigned" warning is expected. */
export function btVerify(tx: string, chain: string, to: string, maxFee: string) {
  const w = blocktools();
  if (!w) return null;
  return JSON.parse(w.verifyTx(tx, chain, [to], [], undefined, maxFee, false)) as {
    ok: boolean;
    failures: string[];
    warnings: string[];
  };
}

/**
 * Watch-only addresses from an account-level xpub (public input only; GRS xpubs carry the Groestl-512 checksum).
 * Returns null when the WASM is unavailable or blocktools rejects the xpub for this chain.
 */
export function btXpubAddresses(
  xpub: string,
  chain: string,
  kinds: string[],
  branches: number[],
  indices: number[],
): { chain: string; kind: string; path: string; address: string }[] | null {
  const w = blocktools();
  if (!w) return null;
  try {
    return JSON.parse(
      w.addressesFromXpub(
        xpub,
        chain,
        kinds,
        Uint32Array.from(branches),
        Uint32Array.from(indices),
      ),
    );
  } catch {
    return null;
  }
}

/** Polkadot helpers (blocktools 000a71a). Fail closed: throw when the WASM is unavailable, no TS fallback. */
const need = (): Wasm => {
  const w = blocktools();
  if (!w) throw new Error("blocktools unavailable");
  return w;
};
/** SS58 (any prefix) -> { prefix, account: 32-byte hex }. Throws on bad base58/checksum/length. */
export const btSs58Decode = (addr: string) =>
  JSON.parse(need().ss58Decode(addr)) as { prefix: number; account: string };
/** System.Account storage key (0x-prefixed) for an SS58 address or 32-byte hex account. */
export const btDotStorageKey = (account: string) =>
  `0x${need().polkadotAccountStorageKey(account).replace(/^0x/, "")}`;
/** SCALE AccountInfo -> balances as bigint. */
export function btDecodeAccountInfo(hex: string): {
  free: bigint;
  reserved: bigint;
  frozen: bigint;
} {
  const j = JSON.parse(need().decodeAccountInfo(hex.replace(/^0x/, ""))) as {
    data: { free: string; reserved: string; frozen: string };
  };
  return {
    free: BigInt(j.data.free),
    reserved: BigInt(j.data.reserved),
    frozen: BigInt(j.data.frozen),
  };
}

/** Solana / base58 helpers (blocktools 66dc76c). Fail closed: throw when the WASM is unavailable, no TS fallback. */
const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");
/** Bitcoin-alphabet base58 of raw bytes. */
export const btB58Encode = (b: Uint8Array) => need().base58Encode(hexOf(b));
/** Raw bytes of a bitcoin-alphabet base58 string; throws bad_base58. */
export const btB58Decode = (s: string) =>
  Uint8Array.from(Buffer.from(need().base58Decode(s), "hex"));
/** Is this 32-byte string a valid ed25519 point (a wallet key)? PDAs are off-curve. */
export const btSolOnCurve = (b: Uint8Array) => need().solIsOnCurve(btB58Encode(b));
/** findProgramAddress: highest-bump off-curve sha256(seeds|bump|program|"ProgramDerivedAddress"). */
export function btSolPda(seeds: Uint8Array[], program: string): { address: string; bump: number } {
  return JSON.parse(need().solFindProgramAddress(JSON.stringify(seeds.map(hexOf)), program));
}
/** Associated token account of owner for mint (tokenProgram omitted = classic SPL Token). */
export const btSolAta = (owner: string, mint: string, tokenProgram = "") =>
  (JSON.parse(need().solAssociatedTokenAddress(owner, mint, tokenProgram)) as { address: string })
    .address;
/** Anchor instruction discriminator: first 8 bytes (hex) of sha256("global:<name>"). */
export const btSolAnchorDisc = (name: string) => need().solAnchorDiscriminator(name);
export type BtSolTx = {
  version: "legacy" | 0;
  txid: string;
  fee_payer: string;
  recent_blockhash: string;
  num_required_signatures: number;
  accounts: { pubkey: string; signer: boolean; writable: boolean }[];
  address_table_lookups: { table: string; writable: number[]; readonly: number[] }[];
  instructions: ({ program: string; kind: string } & Record<string, unknown>)[];
  signatures: { signer: string; status: "valid" | "invalid" | "unsigned" }[];
  message_hex: string;
};
/** Decode a Solana wire tx (hex or base64; legacy or v0). Throws on malformed input. */
export const btSolDecodeTx = (raw: string) => JSON.parse(need().solDecodeTx(raw)) as BtSolTx;

/** Address helpers (blocktools 61f1297). Fail closed: throw when the WASM is unavailable; false/null = invalid. */
export function btAddrValid(chain: string, addr: string): boolean {
  const w = need();
  try {
    w.addressValidate(chain, addr);
    return true;
  } catch {
    return false;
  }
}
/** Every chain the address is valid on. */
export const btDetectChains = (addr: string): string[] =>
  (JSON.parse(need().detectAddress(addr)) as { chain: string }[]).map((d) => d.chain);
/** BCH CashAddr (prefix optional, checksum verified) -> legacy base58; null when not a valid CashAddr. */
export function btCashToLegacy(addr: string): string | null {
  const w = need();
  try {
    return w.cashAddrToLegacy(addr);
  } catch {
    return null;
  }
}

/** EVM recovery / sweep verifiers (blocktools 7a6d945, viem-parity corpus). Fail closed: throw when the WASM
 *  is unavailable; there is no TS copy. */
export type BtVerdict =
  | { readonly verified: true; readonly call: string }
  | { readonly verified: false; readonly reason: string };
const big = (o: unknown) =>
  JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
/** tx = {to, data, value}; nowS = unix seconds (exit deadlines are checked against it). */
export const btVerifyRecovery = (tx: unknown, owner: string, nowS: number): BtVerdict =>
  JSON.parse(need().verifyRecovery(big(tx), owner, nowS)) as BtVerdict;
/** tx = {from, to, value, data?, chainId}; token "" = native sweep. */
export const btVerifySweepTx = (
  tx: unknown,
  owner: string,
  chainId: number,
  token = "",
): BtVerdict => JSON.parse(need().verifySweepTx(big(tx), owner, chainId, token)) as BtVerdict;
/** Bitcoin-family address -> scriptPubKey hex for one chain (version bytes / HRP / checksum checked, BIP-173 case
 *  rule: mixed-case bech32 is refused). null when the address is not valid for that chain; throws if the WASM is
 *  unavailable (fail closed). */
export function btAddressToScript(chain: string, addr: string): string | null {
  const w = need();
  try {
    return w.addressToScript(chain, addr);
  } catch {
    return null;
  }
}

export type BtPsbt = { psbt: string; fee: string; vsize: number; rbf: boolean };
/** Unsigned BTC PSBT: `amount` to `to` (VOUT0), change to `change` (VOUT1, when above dust), OP_RETURN memo last
 *  (THORChain order). Non-RBF (nSequence 0xffffffff), like the old btc.ts. Throws blocktools' error; throws if the
 *  WASM is unavailable (fail closed, no TS fallback). */
export function btBuildPsbt(
  chain: string,
  utxos: { txid: string; vout: number; amount: number | string; address: string }[],
  to: string,
  amount: bigint,
  change: string,
  feeRate: number,
  memoHex: string,
): BtPsbt {
  const lines = utxos
    .map((u) =>
      JSON.stringify({
        txid: u.txid,
        vout: u.vout,
        amount: BigInt(u.amount).toString(),
        address: u.address,
      }),
    )
    .join("\n");
  // amounts in this output are decimal strings already (EXPORTS.md)
  return JSON.parse(
    need().buildPsbtWithMemo(chain, lines, to, amount.toString(), change, feeRate, memoHex, false),
  ) as BtPsbt;
}
