import { createRequire } from "node:module";

/**
 * TSavo/blocktools public API (WASM, default features: no secrets/signing), vendored in ../vendor/blocktools
 * (see vendor/blocktools/SOURCE). Loaded once; if it fails to load, every helper returns null and callers fall
 * back to the TypeScript implementation, so a bad build can never take the scanner down.
 */
type Wasm = {
  version(): string;
  chainParams(): string;
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
 * JSON.parse that keeps integers above 2^53 exact: blocktools emits amounts as JSON numbers, and big-supply
 * coins (RDD: 33,979,404,789,171,950 units) exceed float precision. Bare integer tokens of 16+ digits become strings.
 */
export function bigJson<T>(raw: string): T {
  return JSON.parse(raw.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"')) as T;
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
  pos_prevouts?: { amount: number | string; script: string }[];
  /** zcash-v5: consensus branch id (hex), expiry height and the prevouts (ZIP-244 commits to amounts) */
  branch_id?: string;
  expiry_height?: number;
  zec_prevouts?: { amount: number | string; script: string }[];
  /** the raw JSON line blocktools returned (decode/verify input for pos-ntime) */
  envelope?: string;
  inputs: unknown[];
  amount: string | number;
  fee: string | number;
};
/** Throws blocktools' error (e.g. unsupported_tx_format:pos-ntime); returns null only when the WASM is unavailable. */
export function btSweep(
  chain: string,
  utxos: { txid: string; vout: number; amount: number | string; address: string }[],
  to: string,
  feeRate: number,
  /** unix seconds; when set, builds with buildUnsignedSweepAt (required by pos-ntime chains ppc/nvc/clam/rdd) */
  time?: number,
): BtSweep | null {
  const w = blocktools();
  if (!w) return null;
  // amount as an exact integer token (Number() would round amounts above 2^53)
  const lines = utxos
    .map(
      (u) =>
        `{"txid":${JSON.stringify(u.txid)},"vout":${u.vout},"amount":${BigInt(u.amount)},"address":${JSON.stringify(u.address)}}`,
    )
    .join("\n");
  const raw =
    time === undefined
      ? w.buildUnsignedSweep(chain, lines, to, feeRate)
      : w.buildUnsignedSweepAt(chain, lines, to, feeRate, time);
  return { ...bigJson<BtSweep>(raw), envelope: raw };
}

export type BtDecoded = {
  role: string;
  fee?: number | string;
  inputs?: number;
  outputs?: number;
  txid?: string;
  address?: string;
  amount?: number | string;
}[];
/** decodeTx lines (summary, inputs, outputs) for a built tx/PSBT. Throws on a decode error. */
export function btDecode(tx: string, chain: string): BtDecoded | null {
  const w = blocktools();
  return w ? bigJson<BtDecoded>(w.decodeTx(tx, chain)) : null;
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
      w.addressesFromXpub(xpub, chain, kinds, Uint32Array.from(branches), Uint32Array.from(indices)),
    );
  } catch {
    return null;
  }
}
