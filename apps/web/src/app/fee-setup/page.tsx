"use client";

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { useState } from "react";
import { useSolana } from "@/lib/useSolana";

/** One-time: open token accounts owned by the SwapChan Solana fee wallet so Jupiter routes can pay
 * our platform fee (Jupiter takes it in the output mint). Anyone can pay the rent (~0.002 SOL each);
 * the accounts belong to the fee wallet. Idempotent: existing accounts are skipped. Not linked in nav. */
const FEE_OWNER = new PublicKey("BUqwuxGmshL5aT9eW79D4c8kVdwCjcZLXjiotAntwFJE");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINTS: [string, string][] = [
  ["SOL (wSOL)", "So11111111111111111111111111111111111111112"],
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["USDT", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["cbBTC", "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"],
];

export default function FeeSetup() {
  const sol = useSolana();
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState("");
  const run = async () => {
    try {
      if (!sol.address || !sol.provider || !sol.connection) return sol.open();
      const payer = new PublicKey(sol.address);
      const mints = [...MINTS.map((m) => m[1]), ...extra.split(/[\s,]+/).filter(Boolean)].map(
        (m) => new PublicKey(m),
      );
      const infos = await sol.connection.getMultipleAccountsInfo(mints);
      const ixs: TransactionInstruction[] = [];
      const todo: string[] = [];
      for (const [i, mint] of mints.entries()) {
        const program = infos[i]?.owner;
        if (!program) continue;
        const [ata] = PublicKey.findProgramAddressSync(
          [FEE_OWNER.toBuffer(), program.toBuffer(), mint.toBuffer()],
          ATA_PROGRAM,
        );
        if (await sol.connection.getAccountInfo(ata)) continue;
        todo.push(mint.toBase58());
        ixs.push(
          new TransactionInstruction({
            programId: ATA_PROGRAM,
            keys: [
              { pubkey: payer, isSigner: true, isWritable: true },
              { pubkey: ata, isSigner: false, isWritable: true },
              { pubkey: FEE_OWNER, isSigner: false, isWritable: false },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: program, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([1]), // CreateIdempotent
          }),
        );
      }
      if (!ixs.length) return setMsg("All fee accounts already exist. Nothing to do.");
      // Pre-check: rent for each new token account (165 bytes) + network fee per tx.
      const conn = sol.connection;
      const rent = await conn.getMinimumBalanceForRentExemption(165);
      const batches: TransactionInstruction[][] = [];
      for (let i = 0; i < ixs.length; i += 4) batches.push(ixs.slice(i, i + 4));
      const need = rent * ixs.length + 10_000 * batches.length;
      const have = await conn.getBalance(payer);
      const fmt = (l: number) => (l / 1e9).toFixed(4);
      if (have < need)
        return setMsg(
          `Not enough SOL: creating ${ixs.length} account(s) needs ${fmt(need)} SOL (rent ${fmt(rent)} each + fees), wallet ${sol.address} has ${fmt(have)} SOL. Top up at least ${fmt(need - have)} SOL and retry.`,
        );
      const sigs: string[] = [];
      for (const [n, batch] of batches.entries()) {
        const { blockhash } = await conn.getLatestBlockhash();
        const tx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: payer,
            recentBlockhash: blockhash,
            instructions: batch,
          }).compileToV0Message(),
        );
        const sim = await conn.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        if (sim.value.err)
          return setMsg(
            `Simulation failed (batch ${n + 1}/${batches.length}): ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).slice(-8).join("\n")}`,
          );
        sigs.push(await sol.provider.signAndSendTransaction(tx));
        setMsg(`Sent ${sigs.length}/${batches.length}: ${sigs.join(", ")}`);
      }
      setMsg(`Done: created ${todo.length} fee account(s). Tx: ${sigs.join(", ")}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="mt-8 w-full max-w-lg rounded-3xl border-2 border-violet-500/40 bg-violet-950/80 p-5">
      <h1 className="text-2xl font-black">Solana fee accounts</h1>
      <p className="mt-2 text-sm text-violet-200">
        Opens token accounts owned by the fee wallet {FEE_OWNER.toBase58()} for:{" "}
        {MINTS.map((m) => m[0]).join(", ")}. Costs about 0.002 SOL rent each, paid by the connected
        wallet.
      </p>
      <textarea
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        placeholder="Extra mints (optional), comma or space separated"
        className="mt-3 w-full rounded-xl bg-violet-900 p-2 text-sm"
      />
      <button
        type="button"
        onClick={run}
        className="mt-3 rounded-full bg-fuchsia-500 px-5 py-2 font-bold text-white"
      >
        {sol.address ? "Create fee accounts" : "Connect Solana wallet"}
      </button>
      {msg && <p className="mt-3 whitespace-pre-wrap break-all text-sm">{msg}</p>}
    </div>
  );
}
