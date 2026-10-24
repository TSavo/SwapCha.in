import type { Metadata } from "next";
import Link from "next/link";
import { AgentCTAs } from "@/components/AgentCTA";
import { SpeechBubble } from "@/components/Character";

export const metadata: Metadata = {
  title: "Where crypto money gets stuck, and how to get it back (free) | SwapChan",
  description:
    "A field guide to forgotten crypto: unclaimed dividends (PoWH3D, Fomo3D), vault shares, LP fees, Lido withdrawals, wrapped ETH, Safes, Solana stake and rent, airdrops. Free checker, ready-to-sign recovery, then swap to USDC.",
  alternates: { canonical: "/find-money/guide" },
};

type Row = [category: string, chains: string, examples: string, detection: string, coverage: "Covered" | "New" | "Not yet"];
const ROWS: Row[] = [
  ["Legacy dividend contracts", "Ethereum", "PoWH3D (P3D), Fomo3D, EtherDelta", "dividendsOf / getPlayerVaults / balanceOf on the contract", "Covered"],
  ["Vault & yield shares", "EVM", "ERC-4626 vaults, Yearn v1/v2", "share balance × convertToAssets + redeem/withdraw tx + evidence", "Covered"],
  ["Uncollected LP fees", "EVM", "Uniswap v3 positions", "positions() tokensOwed + static collect()", "Covered"],
  ["Accrued lending rewards", "EVM", "Compound COMP, Venus XVS", "compAccrued / venusAccrued", "Covered"],
  ["Lending deposits", "EVM", "Aave, Compound, Venus, JustLend", "aToken / cToken / jToken balances", "Covered"],
  ["Unwrapped wrapped native", "EVM + Tron", "WETH, WBNB, WPOL, WAVAX, WTRX", "balanceOf + withdraw evidence", "Covered"],
  ["Finalized unstake requests", "Ethereum", "Lido withdrawal NFTs", "getWithdrawalRequests + getWithdrawalStatus + evidence", "Covered"],
  ["Forgotten multisigs", "EVM", "Safe", "Safe tx service owners → safes, native balance", "Covered"],
  ["Merkle airdrops & rewards", "EVM", "Merkl + UNI/ENS/1INCH/OP/ARB distributors", "Merkl API + distributor portals / claim trees when published", "Covered"],
  ["Old LP tokens", "EVM", "Uniswap v2, Sushi pairs", "LP balance × reserves + removeLiquidity tx (approve router first)", "Covered"],
  ["Rent in empty token accounts", "Solana", "SPL token accounts", "getTokenAccountsByOwner, zero balance", "Covered"],
  ["Deactivated stake accounts", "Solana", "Native stake", "getProgramAccounts + StakeProgram.Withdraw svm-instructions", "Covered"],
  ["Solana program archaeology", "Solana", "History programs + SPL balances", "signatures → program ids; token accounts by owner", "New"],
  ["Tron stake / votes / resources", "Tron", "Stake 1.0+2.0, voting rewards, delegated BW/energy", "getaccount + WithdrawBalance / WithdrawExpireUnfreeze", "Covered"],
  ["Tron DeFi + archaeology", "Tron", "JustLend, WTRX, JST, USDJ, sTRX/stUSDT, SUN, 2019–21 dividend dapps", "TronGrid views + recoveryHints + promote-candidates log", "New"],
  ["L2 withdrawals not finalized", "Optimism, Arbitrum, Base", "OP/Base MessagePasser, ArbSys", "Detect prior withdraw txs; prove/finalize still manual on official bridges", "New"],
  ["Bridge exits", "Polygon PoS, Multichain, Celer", "PoS portal, Anyswap, cBridge", "History detect + explain (Multichain often unrecoverable)", "New"],
  ["Gauges, escrow, streams", "EVM", "Curve/Convex, Synthetix, Sablier, Pendle, GMX, Rocket Pool rETH", "known-contract registry handlers + evidence", "New"],
  ["Governance airdrops", "EVM", "ENS, UNI, 1INCH, OP, ARB", "Distributor live check + claim tx when merkle tree published", "New"],
  ["Bitcoin", "BTC", "xpub / bc1 / legacy addresses", "blockchain.info multiaddr + mempool.space UTXO (read-only)", "New"],
  ["Unknown contract archaeology", "Every supported chain", "Any history contract with earned/claimable/balance", "Probe recovery selectors, Sourcify ABI, confidence + promote-to-registry log", "New"],
];

const badge = { Covered: "bg-emerald-800", New: "bg-amber-400 text-violet-950", "Not yet": "bg-violet-800" };

export default function Page() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10 text-white">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-black">Where crypto money gets stuck (and how to get it back)</h1>
        <SpeechBubble who="swapchan">
          SwapChan is here to help you find your money, senpai! Paste a wallet and I'll look in every corner I know: old
          dividend contracts, vaults, LP fees, unstakes, wrapped ETH, Safes, Solana stake. Then I hand you the exact
          transaction to get it back, and a swap to USDC.
        </SpeechBubble>
        <Link href="/dashboard" className="self-start rounded-full bg-amber-300 px-7 py-3 text-lg font-black text-violet-950">
          Find my money →
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">1. It finds your lost money</h2>
        <p>
          A real wallet we tested had <b>1.27 ETH of PoWH3D dividends</b> sitting in a 2018 contract, plus 0.0168 ETH in a
          Fomo3D vault. Replaying our checks at the block before each withdrawal finds those amounts to the wei and builds
          the same <code>withdraw()</code> call the owner actually sent. Those replays are now regression tests.
        </p>
        <h3 className="text-xl font-bold">Every finding ends in a link</h3>
        <ol className="list-decimal pl-6">
          <li><b>Step 1, get it back:</b> a permanent swapchan.com/recover page. It decodes the call, you connect your wallet and sign it yourself. We only build calls that pay <i>you</i> (withdraw, exit, redeem to self, collect to self, claimWithdrawal) and never send value.</li>
          <li><b>Step 2, swap it:</b> a prefilled SwapChan swap to USDC, with a short link.</li>
          <li><b>Swap all of it:</b> one batch link for everything found.</li>
        </ol>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border-2 border-emerald-400 bg-emerald-950 p-6">
        <h2 className="text-2xl font-black">Trustless by design</h2>
        <p>
          SwapChan <b>never signs transactions, never holds your keys or funds, and can't store or spend money.</b> It only
          builds <i>unsigned</i> transactions. Your own wallet signs every step, and you can read the decoded call before
          you do.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border-2 border-fuchsia-400 bg-violet-950 p-6">
        <h2 className="text-2xl font-black">2. Your agent does it for you</h2>
        <p>
          Add the SwapChan MCP server and your agent gets the <code>find_money</code> tool. Then just say:
        </p>
        <blockquote className="rounded-xl bg-violet-900 p-4 text-lg font-bold">“Here's my wallet, find me money.”</blockquote>
        <p>It returns ranked findings with the recover step, the swap step and the swap-all link. You still sign everything in your own wallet.</p>
        <h3 className="text-xl font-bold">Agent-first: information, not just buttons</h3>
        <p>
          SwapChan is built to make agents smart about chain state. Every finding comes back as a structured, verifiable
          recovery package your agent can reason over, re-check and act on alone:
        </p>
        <ul className="list-disc pl-6 text-sm">
          <li><b>contract</b>: chain, address, explorer and verified-source link</li>
          <li><b>detection</b>: each read call, args, block number and raw return value</li>
          <li><b>interface</b>: ABI fragments for the reads and the recovery function</li>
          <li><b>value</b>: estimated USD plus the pricing source</li>
          <li><b>recoveryTx</b>: exact unsigned to / data / value, checked to pay only you</li>
          <li><b>swapUrl</b> + short link, and a swap-all batch link</li>
        </ul>
        <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 text-xs">{`"recovery": {
  "contract": { "chainId": 1, "address": "0xB3775fB83F7D12A36E0475aBdD1FCA35c091efBe",
                "verifiedSource": "https://etherscan.io/address/0xB377…efBe#code" },
  "detection": [{ "call": "dividendsOf(address)", "block": "26095609",
                  "raw": "1272687502039539941" }],
  "interface": { "reads": ["function dividendsOf(address) view returns (uint256)"],
                 "recovery": "function withdraw()" },
  "value": { "estUsd": 4200, "pricingSource": "DefiLlama coins API" },
  "recoveryTx": { "to": "0xB377…efBe", "data": "0x3ccfd60b", "value": "0",
                  "unsigned": true, "verified": true }
}`}</pre>
        <p className="text-sm">
          Full agent loop: find_money →{" "}
          <Link href="/agents/secure-signing" className="underline">signing_guide / verify_tx</Link> → human signs →{" "}
          <Link href="/broadcast" className="underline">broadcast_tx</Link>. Lost the key?{" "}
          <Link href="/recover" className="underline">Key recovery hub</Link>.
        </p>
        <AgentCTAs />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">3. It's completely free, and here's why</h2>
        <p>
          No signup, no fee for checking, no cut of what you recover. It's free because recoveries usually end in a swap,
          and if you swap on SwapChan we earn our normal small swap fee. The free finder is how people meet SwapChan. You
          can also take the recovery tx and swap anywhere you like.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">The map: every place we know money gets stuck</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-violet-300">
              <tr><th className="p-2">Category</th><th className="p-2">Chains</th><th className="p-2">Examples</th><th className="p-2">How we detect it (read-only)</th><th className="p-2">Coverage</th></tr>
            </thead>
            <tbody>
              {ROWS.map(([c, ch, ex, det, cov]) => (
                <tr key={c} className="border-t border-violet-800">
                  <td className="p-2 font-bold">{c}</td><td className="p-2">{ch}</td><td className="p-2">{ex}</td><td className="p-2">{det}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs font-bold ${badge[cov]}`}>{cov}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-violet-300">
          “Not yet” means we say so in results instead of pretending. Mixers are out of scope.
        </p>
      </section>
    </main>
  );
}
