import { base58 } from "@scure/base";
import { btSolAnchorDisc, btSolPda } from "./blocktools.js";

/** Solana recovery txs the /recover?sol= page will sign: allowlisted programs, owner is the only signer, money goes to owner. */
export type SolIx = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};
export type SolSpec = { owner: string; ix: SolIx[] };

export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
export const MARINADE = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
export const MARINADE_STATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
export const CLOCK = "SysvarC1ock11111111111111111111111111111111";
export const SYSTEM = "11111111111111111111111111111111";

export const anchorDisc = (name: string) => btSolAnchorDisc(name);

/** findProgramAddress via blocktools wasm (fails closed). */
export const findPda = (seeds: Uint8Array[], program: string): string =>
  btSolPda(seeds, program).address;
export const marinadeReserve = () =>
  findPda([base58.decode(MARINADE_STATE), new TextEncoder().encode("reserve")], MARINADE);

export function marinadeClaimIx(ticket: string, owner: string): SolIx {
  return {
    programId: MARINADE,
    keys: [
      { pubkey: MARINADE_STATE, isSigner: false, isWritable: true },
      { pubkey: marinadeReserve(), isSigner: false, isWritable: true },
      { pubkey: ticket, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: CLOCK, isSigner: false, isWritable: false },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
    ],
    data: anchorDisc("claim"),
  };
}

/** Server-side gate (mirrored in apps/web SolRecover). Returns null when OK, else the reason. */
export function checkSolSpec(s: SolSpec, owner: string): string | null {
  if (!s?.ix?.length || s.owner !== owner) return "different wallet";
  for (const ix of s.ix) {
    if (ix.keys.some((k) => k.isSigner && k.pubkey !== owner)) return "extra signer";
    if (ix.programId === STAKE_PROGRAM) {
      if (!ix.data.startsWith("04000000") || ix.data.length !== 24) return "only stake Withdraw";
      if (ix.keys[1]?.pubkey !== owner || ix.keys[3]?.pubkey !== owner)
        return "stake withdraw not to owner";
    } else if (ix.programId === MARINADE) {
      if (ix.data !== anchorDisc("claim")) return "only Marinade claim";
      if (
        ix.keys[0]?.pubkey !== MARINADE_STATE ||
        ix.keys[1]?.pubkey !== marinadeReserve() ||
        ix.keys[3]?.pubkey !== owner
      )
        return "Marinade claim not to owner";
    } else return "program not allowlisted";
  }
  return null;
}
export const encodeSol = (s: SolSpec) => Buffer.from(JSON.stringify(s)).toString("base64url");
