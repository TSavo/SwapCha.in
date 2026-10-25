import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { blocktools } from "./blocktools.js";

// solBuildTransfer (blocktools 51a1844+) vs an independent reference: @solana/web3.js legacy Transaction
// + @solana/spl-token instructions. Program IDs come from the spl-token constants, never literals.
// solVerifyTx `to` for token transfers is the destination token account (ATA), not the owner wallet.
const w = blocktools() as any;
let seed = 0x50a1;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const bytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
const key = () => Keypair.fromSeed(bytes(32)).publicKey;
const blockhash = () => new PublicKey(bytes(32)).toBase58();
const int = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo));
const ZERO_SIG = `01${"00".repeat(64)}`;

type Case = { plan: Record<string, unknown>; ref: string; expect: Record<string, unknown> };

function refHex(
  from: PublicKey,
  bh: string,
  prio: [string, number] | undefined,
  ixs: Transaction["instructions"],
) {
  const tx = new Transaction({ feePayer: from, recentBlockhash: bh });
  if (prio) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: prio[1] }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(prio[0]) }));
  }
  tx.add(...ixs);
  return ZERO_SIG + Buffer.from(tx.serializeMessage()).toString("hex");
}

function tokenCases(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const program = i % 2 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const from = key();
    const to = key();
    const mint = key();
    const bh = blockhash();
    const decimals = int(0, 10);
    const amount = BigInt(int(1, 2 ** 31)) * BigInt(int(1, 1000));
    const create = i % 3 === 0;
    const prio: [string, number] | undefined =
      i % 5 < 2 ? [String(int(1, 500000)), int(200, 1400000)] : undefined;
    const src = getAssociatedTokenAddressSync(
      mint,
      from,
      false,
      program,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const dst = getAssociatedTokenAddressSync(
      mint,
      to,
      false,
      program,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const ixs = [
      ...(create
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              from,
              dst,
              to,
              mint,
              program,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          ]
        : []),
      createTransferCheckedInstruction(src, mint, dst, from, amount, decimals, [], program),
    ];
    out.push({
      plan: {
        from: from.toBase58(),
        to: to.toBase58(),
        blockhash: bh,
        ...(prio ? { priority: prio } : {}),
        token: {
          mint: mint.toBase58(),
          amount: String(amount),
          decimals,
          token_program: program.toBase58(),
          create_ata: create,
        },
      },
      ref: refHex(from, bh, prio, ixs),
      expect: {
        owner: from.toBase58(),
        to: dst.toBase58(),
        mint: mint.toBase58(),
        amount: String(amount),
      },
    });
  }
  return out;
}

function solCases(n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const from = key();
    const to = key();
    const bh = blockhash();
    const lamports = BigInt(int(1, 2 ** 31)) * 1000n;
    const prio: [string, number] | undefined =
      i % 2 ? [String(int(1, 500000)), int(200, 1400000)] : undefined;
    const sweep = i % 4 >= 2;
    let send = lamports;
    if (sweep) {
      const fee = 5000n + (prio ? (BigInt(prio[0]) * BigInt(prio[1]) + 999999n) / 1000000n : 0n);
      send = lamports - fee;
    }
    out.push({
      plan: {
        from: from.toBase58(),
        to: to.toBase58(),
        blockhash: bh,
        ...(prio ? { priority: prio } : {}),
        ...(sweep ? { sweep_balance: String(lamports) } : { lamports: String(lamports) }),
      },
      ref: refHex(from, bh, prio, [
        SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: send }),
      ]),
      expect: { owner: from.toBase58(), to: to.toBase58(), lamports: String(send) },
    });
  }
  return out;
}

function run(cases: Case[]) {
  let same = 0;
  let verified = 0;
  const diffs: string[] = [];
  for (const c of cases) {
    const hex = w.solBuildTransfer(JSON.stringify(c.plan)) as string;
    if (hex === c.ref) same++;
    else if (diffs.length < 3) diffs.push(JSON.stringify({ plan: c.plan, bt: hex, ref: c.ref }));
    const v = JSON.parse(w.solVerifyTx(hex, JSON.stringify(c.expect)));
    if (v.ok) verified++;
    else if (diffs.length < 3) diffs.push(JSON.stringify({ verify: v.failures }));
    JSON.parse(w.solDecodeTx(hex));
  }
  return { same, verified, diffs };
}

describe("solBuildTransfer parity with web3.js + spl-token", { timeout: 60_000 }, () => {
  it("120 SOL send/sweep cases: byte-identical messages, solVerifyTx ok", () => {
    const r = run(solCases(120));
    expect(r.diffs).toEqual([]);
    expect(r).toMatchObject({ same: 120, verified: 120 });
  });
  it("180 SPL Token / Token-2022 cases: byte-identical messages, solVerifyTx ok", () => {
    const r = run(tokenCases(180));
    expect(r.diffs).toEqual([]);
    expect(r).toMatchObject({ same: 180, verified: 180 });
  });
});
