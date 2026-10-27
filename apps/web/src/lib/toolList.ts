/** The free toolbox: one entry per SEO tool page, each backed by an MCP tool. */
export interface ToolInfo {
  href: string;
  name: string;
  mcp: string;
  blurb: string;
  prompt: string;
  emoji: string;
}
export const TOOLS: ToolInfo[] = [
  {
    href: "/dashboard",
    name: "Find money in your wallet",
    mcp: "find_money",
    emoji: "💰",
    blurb:
      "Forgotten claims, idle stablecoins, risky approvals, dust and lending positions, ranked by dollars. EVM, Solana, Tron, Bitcoin, 25+ old coins (unsigned sweeps), XRP, XLM, ADA, DOT, TON.",
    prompt: "Here's my wallet vitalik.eth, find me money.",
  },
  {
    href: "/simulate",
    name: "Transaction simulator",
    mcp: "simulate_swap",
    emoji: "🧪",
    blurb: "Dry-run any transaction: balance changes, approvals, revert reasons, before you sign.",
    prompt: "Simulate this swap before I sign it.",
  },
  {
    href: "/wallet",
    name: "Wallet history & PnL",
    mcp: "wallet_history",
    emoji: "📜",
    blurb: "Recent swaps and an average-cost PnL estimate for any EVM or Solana wallet.",
    prompt: "Show me vitalik.eth's recent swaps and PnL.",
  },
  {
    href: "/token",
    name: "Token pools & whales",
    mcp: "token_pools",
    emoji: "🐋",
    blurb:
      "Where a token trades, how deep the liquidity is, and what the biggest wallets are doing.",
    prompt: "Where does BRETT on Base trade, and are whales selling?",
  },
  {
    href: "/contract",
    name: "Contract reader",
    mcp: "contract_reader",
    emoji: "🔍",
    blurb: "Verified source, proxy, owner powers (pause, blacklist, mint) in plain English.",
    prompt: "What can the owner of USDT on Ethereum do?",
  },
  {
    href: "/read-chain",
    name: "Chain state reader",
    mcp: "read_chain",
    emoji: "📖",
    blurb:
      "Balances, contract calls, storage, logs and historical reads on EVM, Solana, Tron and Bitcoin. Read-only.",
    prompt: "Use read_chain to check vitalik.eth's WETH balance at block 18000000.",
  },
  {
    href: "/airdrops",
    name: "Airdrop & unclaimed checker",
    mcp: "airdrop_check",
    emoji: "🪂",
    blurb:
      "Merkl rewards on 9 chains, legacy contracts (PoWH3D, Fomo3D, EtherDelta and other old DEXes, Fomo3D forks, PoWH3D clones, old ETH wrappers, ICO refunds, NFT-market pull payments and token redemptions; 149 contracts confirmed so far), Solana and Tron.",
    prompt: "Does vitalik.eth have anything unclaimed?",
  },
  {
    href: "/market",
    name: "Market context",
    mcp: "market_context",
    emoji: "📈",
    blurb: "Fear & greed, funding, open interest, stablecoin supply and DeFi TVL in one read.",
    prompt: "What's the market mood right now?",
  },
  {
    href: "/rebalance",
    name: "Portfolio rebalancer",
    mcp: "rebalance_plan",
    emoji: "⚖️",
    blurb: "Target weights in, a priced swap plan out, with live best-route quotes.",
    prompt: "Rebalance my wallet to 50% ETH, 50% USDC.",
  },
  {
    href: "/bridge-status",
    name: "Bridge doctor",
    mcp: "bridge_doctor",
    emoji: "🩺",
    blurb:
      "Stuck bridge? Paste the tx: LI.FI, Across, Relay, deBridge and THORChain checked at once.",
    prompt: "My bridge tx 0x… is stuck, what happened?",
  },
  {
    href: "/gas",
    name: "Gas tracker & best time to swap",
    mcp: "best_time_to_swap",
    emoji: "⛽",
    blurb: "Live base fee, 1024-block percentiles and the cheapest hour of the day.",
    prompt: "When is the cheapest time to swap on Ethereum?",
  },
];
export const tool = (mcp: string) => TOOLS.find((t) => t.mcp === mcp) ?? TOOLS[0]!;
