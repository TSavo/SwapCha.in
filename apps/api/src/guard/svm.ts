import { base64, hex } from "@scure/base";
import { btSolAta, btSolDecodeTx, btSolPda } from "../blocktools.js";

export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM = "11111111111111111111111111111111";
export const WSOL = "So11111111111111111111111111111111111111112";

/** findProgramAddress (same as @solana/web3.js PublicKey.findProgramAddressSync), via blocktools wasm. */
export const pda = (seeds: Uint8Array[], program: string): string =>
  btSolPda(seeds, program).address;

export const ata = (owner: string, mint: string, tokenProgram = TOKEN) =>
  btSolAta(owner, mint, tokenProgram === TOKEN ? "" : tokenProgram);

export interface Ix {
  programId: string;
  /** Account pubkeys; undefined = resolved through an address lookup table (unknown here). */
  keys: (string | undefined)[];
  signers: Set<string>;
  data: Uint8Array;
}

/**
 * Decode a Solana wire tx (legacy + v0) with the blocktools wasm (replaces the hand-rolled shortvec/account/
 * instruction reader, 9b... migration). blocktools resolves each instruction's `account_indexes` against the
 * message's static account keys; an index into an address-lookup table (beyond the static keys) stays
 * `undefined` here, exactly as the old parser left it (checkSvmIxs treats an unknown destination as a failure).
 * Program ids are static message keys. Fails closed: throws when the wasm is unavailable or the tx is malformed.
 */
export function parseSvmBase64(b64: string): { feePayer: string; signers: string[]; ixs: Ix[] } {
  const d = btSolDecodeTx(Buffer.from(base64.decode(b64)).toString("hex"));
  const keys = d.accounts.map((a) => a.pubkey);
  const signers = keys.slice(0, d.num_required_signatures);
  const sset = new Set(signers);
  const ixs: Ix[] = d.instructions.map((ix) => ({
    programId: ix.program,
    keys: ix.account_indexes.map((j) => keys[j]),
    signers: sset,
    data: hex.decode(ix.data_hex),
  }));
  return { feePayer: d.fee_payer, signers, ixs };
}

type RelayIx = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};
export function parseSvmInstructions(d: { instructions?: RelayIx[] }): Ix[] {
  return (d.instructions ?? []).map((x) => ({
    programId: x.programId,
    keys: x.keys.map((k) => k.pubkey),
    signers: new Set(x.keys.filter((k) => k.isSigner).map((k) => k.pubkey)),
    data: /^[0-9a-fA-F]*$/.test(x.data) ? hex.decode(x.data.toLowerCase()) : base64.decode(x.data),
  }));
}

const u32 = (d: Uint8Array) => (d[0]! | (d[1]! << 8) | (d[2]! << 16)) + d[3]! * 2 ** 24;

export interface SvmVerdict {
  fail: string[];
  notes: string[];
  /** lamports moved out of the taker by System transfers. */
  lamportsOut: bigint;
}

/**
 * Checks every instruction: program allowlisted, no token approvals / authority changes by the
 * taker, System and SPL transfers from the taker only to allowed destinations.
 */
export function checkSvmIxs(
  ixs: Ix[],
  taker: string,
  programs: Record<string, string>,
  allowedDest: Set<string>,
): SvmVerdict {
  const fail: string[] = [];
  const notes: string[] = [];
  let lamportsOut = 0n;
  // Accounts created in this tx as ATAs owned by the taker are the taker's.
  for (const ix of ixs)
    if (ix.programId === ATA_PROGRAM && ix.keys[2] === taker && ix.keys[1])
      allowedDest.add(ix.keys[1]);
  for (const ix of ixs) {
    if (!programs[ix.programId]) fail.push(`program ${ix.programId} not allowlisted`);
    if (ix.programId === SYSTEM && ix.data.length >= 12 && u32(ix.data) === 2) {
      const [from, to] = ix.keys;
      if (from === taker) {
        const lam = new DataView(ix.data.buffer, ix.data.byteOffset + 4, 8).getBigUint64(0, true);
        lamportsOut += lam;
        if (!to || !allowedDest.has(to))
          fail.push(`SOL transfer from taker to unknown account ${to ?? "(lookup table)"}`);
      }
    }
    if ((ix.programId === TOKEN || ix.programId === TOKEN22) && ix.data.length) {
      const t = ix.data[0];
      const authIdx = t === 3 ? 2 : t === 12 ? 3 : t === 4 ? 2 : t === 13 ? 3 : t === 6 ? 1 : -1;
      const auth = authIdx >= 0 ? ix.keys[authIdx] : undefined;
      if ((t === 4 || t === 13) && auth === taker) fail.push("SPL Approve signed by taker");
      if (t === 6 && auth === taker) fail.push("SPL SetAuthority signed by taker");
      if ((t === 3 || t === 12) && auth === taker) {
        const dest = ix.keys[t === 3 ? 1 : 2];
        if (!dest || !allowedDest.has(dest))
          fail.push(`SPL transfer from taker to unknown account ${dest ?? "(lookup table)"}`);
      }
      if (t === 9 && ix.keys[2] === taker && ix.keys[1] !== taker)
        fail.push("CloseAccount sends rent to someone other than the taker");
    }
  }
  return { fail, notes, lamportsOut };
}
