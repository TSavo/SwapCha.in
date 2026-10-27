import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "Read blockchain state, keyless (EVM, Solana, Tron, Bitcoin) | SwapChan read_chain",
  description:
    "Keyless, strictly read-only chain reader for AI agents: balances, token balances, eth_call with ABI decode, storage slots, event logs, blocks, transactions and receipts at any historical block, Solana accounts, Tron resources and Bitcoin UTXOs.",
  alternates: { canonical: "/read-chain" },
};

const OPS: [string, string, string][] = [
  ["EVM", "balance · nonce · token_balance", "Native and ERC-20 balances at any blockTag"],
  [
    "EVM",
    "call",
    'Any view function with ABI decode, e.g. function "dividendsOf(address) view returns (uint256)"',
  ],
  ["EVM", "storage · code", "Raw storage slots (EIP-1967 proxies, owners) and bytecode"],
  ["EVM", "logs", "Events with filters, decoded from a signature, up to 50k blocks per call"],
  ["EVM", "block · tx · receipt", "Lookups by number/hash"],
  ["EVM", "contract", "contract_reader safety read: source, proxy, owner powers"],
  [
    "Solana",
    "sol_account · sol_program_accounts · sol_token_accounts · sol_signatures",
    "getAccountInfo, getProgramAccounts with filters, SPL + Token-2022 accounts",
  ],
  [
    "Tron",
    "tron_account · tron_resources · tron_call",
    "Frozen TRX, energy/bandwidth, triggerConstantContract",
  ],
  ["Bitcoin", "btc_utxos · btc_address · btc_tx", "UTXOs and balances via mempool.space"],
];

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 text-white">
      <h1 className="text-4xl font-black">Read EVM, Solana, Tron and Bitcoin, no keys</h1>
      <SpeechBubble who="swapchan">
        Don&apos;t trust me, check me. read_chain lets your agent re-run every read I used to find
        your money, on EVM chains, Solana, Tron and Bitcoin, at any block. It can only look, never
        touch.
      </SpeechBubble>
      <section className="rounded-2xl border-2 border-emerald-400 bg-emerald-950 p-5">
        <b>Strictly read-only:</b> read_chain only sends read RPC methods (eth_call, eth_getLogs,
        getAccountInfo…). It has no way to sign, send or broadcast.
      </section>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="p-2">Chain</th>
            <th className="p-2">op</th>
            <th className="p-2">What</th>
          </tr>
        </thead>
        <tbody>
          {OPS.map(([c, o, w]) => (
            <tr key={o} className="border-t border-violet-700">
              <td className="p-2">{c}</td>
              <td className="p-2">
                <code>{o}</code>
              </td>
              <td className="p-2">{w}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        API: <code>POST https://api.swapchan.com/onchain/read-chain</code> with{" "}
        <code>
          {
            '{"chainId":1,"op":"call","address":"0x…","function":"totalSupply() view returns (uint256)","blockTag":18000000}'
          }
        </code>
      </p>
      <section className="rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">Use this in your agent</h2>
        <p>
          Add the SwapChan MCP server and ask: &quot;Use read_chain to confirm the P3D dividends
          find_money found for my wallet.&quot; It fits the full loop: <code>find_money</code> →{" "}
          <code>read_chain</code> → <code>verify_tx</code> → you sign → <code>broadcast_tx</code>.
          See the{" "}
          <Link className="underline" href="/agents/playbook">
            agent playbook
          </Link>
          .
        </p>
        <AgentCTAs />
      </section>
    </main>
  );
}
