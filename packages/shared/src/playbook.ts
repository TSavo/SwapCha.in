/**
 * swapchan_playbook: how an agent uses ALL SwapChan tools together. Served by MCP (tool + server instructions),
 * the API (/onchain/playbook) and swapchan.com/agents/playbook. Single source of truth.
 */
export const PRINCIPLES = [
  "Trustless: SwapChan never holds keys or funds, never signs, and cannot move money. Every tx it builds is UNSIGNED; the user's own wallet signs.",
  "Human sign-off on EVERY transaction. No dollar threshold, no blanket approval. Show the verify_tx summary and get an explicit yes for THAT tx.",
  "Verify before sign: run verify_tx on the exact unsigned tx (expected recipient = the user, minOut vs an independent quote). danger = stop.",
  "Confirm, don't trust: re-run find_money evidence yourself with read_chain (same contract, function, args, blockTag) before telling the user it's real money.",
  "Never ask for, accept or paste a recovery phrase or private key into chat. Key recovery code runs LOCALLY OFFLINE on the user's machine (recovery_guide); only PUBLIC addresses come back.",
  "Always give the user BOTH links: the permanent short link (swapchan.com/s/<id>) and the full URL.",
  "Label estimates honestly (exact / estimate / protected). 'Protected' value is money at risk, not new money. Not financial advice.",
  "Prefer recovering first (claim/withdraw/unwrap), then swap. Run token_risk before suggesting any swap INTO a new token.",
];

export const CATALOG: { tool: string; group: string; when: string }[] = [
  {
    tool: "find_money",
    group: "find",
    when: "User gives one wallet (address/ENS/Basename/.sol) and wants money found: ranked items with steps, recovery packages, swapAll.",
  },
  {
    tool: "find_money_batch",
    group: "find",
    when: "User pastes MANY addresses (mixed chains). Returns jobId; poll find_money_status until done, then relay `summary` verbatim and walk `plan`.",
  },
  {
    tool: "find_money_status",
    group: "find",
    when: "Poll a find_money_batch job (every ~15s): progress, running total, final summary and recover-and-swap-all plan.",
  },
  {
    tool: "airdrop_check",
    group: "find",
    when: "Only claimables (Merkl, legacy contracts, Tron rewards, Solana rent).",
  },
  {
    tool: "read_chain",
    group: "read",
    when: "Any raw read on any chain: balances, token balances, eth_call with ABI decode, storage slots, logs/events, blocks/tx/receipts, historical blockTag, Solana accounts/program accounts/token accounts, Tron account/resources/constant calls, Bitcoin UTXOs. Use it to CONFIRM evidence.",
  },
  {
    tool: "contract_reader",
    group: "read",
    when: "Plain-English safety read of a contract: verified source, proxy, owner powers, risk level.",
  },
  { tool: "get_wallet_balances", group: "read", when: "Priced holdings across chains." },
  {
    tool: "wallet_history",
    group: "read",
    when: "Recent swaps / contracts a wallet touched (clues for unknown contracts).",
  },
  { tool: "wallet_pnl", group: "read", when: "Average-cost PnL." },
  { tool: "token_info", group: "read", when: "Token metadata/price." },
  { tool: "token_pools", group: "read", when: "Where a token trades, liquidity." },
  { tool: "whale_watch", group: "read", when: "Large transfers, dev selling." },
  { tool: "explain_transaction", group: "read", when: "Decode a past tx in plain English." },
  { tool: "resolve_name", group: "read", when: "ENS/Basenames/SNS → address." },
  { tool: "get_gas", group: "read", when: "Gas now." },
  { tool: "best_time_to_swap", group: "read", when: "Gas history, cheapest hour." },
  { tool: "market_context", group: "read", when: "Fear & Greed, funding, flows." },
  { tool: "get_yields", group: "read", when: "Where idle stablecoins could earn." },
  {
    tool: "token_risk",
    group: "safety",
    when: "Before buying ANY new token: honeypot/tax/owner flags.",
  },
  {
    tool: "scan_new_tokens / scan_trending / scan_movers",
    group: "safety",
    when: "Memecoin discovery; always pass on risk + disclaimer.",
  },
  { tool: "check_approvals", group: "safety", when: "List token approvals and their risk." },
  { tool: "build_revoke_tx", group: "safety", when: "Unsigned revoke for a risky approval." },
  { tool: "simulate_swap", group: "safety", when: "Dry-run a tx: balance changes, reverts." },
  {
    tool: "verify_tx",
    group: "sign",
    when: "Before EVERY signature: guard + simulation + plain-English summary for the human.",
  },
  {
    tool: "signing_guide",
    group: "sign",
    when: "The full loop: recover key → verify → human signs locally → broadcast.",
  },
  {
    tool: "recovery_guide",
    group: "sign",
    when: "User lost the wallet app but has a phrase, old keystore, 2015 presale JSON, Electrum, wallet.dat… Local offline code; only addresses come back.",
  },
  {
    tool: "broadcast_tx",
    group: "sign",
    when: "Relay bytes the user's wallet already signed (optional Flashbots Protect).",
  },
  { tool: "tx_status", group: "sign", when: "Confirm a broadcast hash." },
  {
    tool: "get_supported_chains / get_supported_tokens",
    group: "swap",
    when: "What can be routed.",
  },
  {
    tool: "get_quote / compare_routes",
    group: "swap",
    when: "Best price across all aggregators and bridges (same- and cross-chain).",
  },
  {
    tool: "build_swap_tx",
    group: "swap",
    when: "Unsigned swap tx from a quoteId (then verify_tx → human → sign → broadcast_tx).",
  },
  { tool: "get_route_status", group: "swap", when: "Track a cross-chain swap." },
  {
    tool: "build_swap_link",
    group: "swap",
    when: "Prefilled swapchan.com link + permanent short link; items[] for one batch link.",
  },
  { tool: "rebalance_plan", group: "swap", when: "Target weights → list of quoted swaps." },
  { tool: "bridge_doctor", group: "rescue", when: "Stuck bridge transfer by source tx hash." },
  {
    tool: "watch_token / list_watches / check_watches / unwatch_token",
    group: "watch",
    when: "Pull-based price watchlist.",
  },
  {
    tool: "swapchan_playbook",
    group: "meta",
    when: "This guide. workflow=<id> for one, full=true for everything.",
  },
];

const SIGN_LOOP = [
  "verify_tx {chainId, tx, expected:{recipient: user, to: expected contract, minOut, quotedOut}} → if danger STOP; if caution explain.",
  "Show the human verify_tx.summary + what they receive, get an explicit yes for THIS tx.",
  "Hand the unsigned tx (or the swapchan.com/recover short + full link) to the user's own wallet to sign. You never see the key.",
  "broadcast_tx {chainId, tx: signed} (private:true on Ethereum for MEV protection) → tx_status until confirmed.",
];

export const WORKFLOWS: Record<
  string,
  { title: string; when: string; steps: string[]; tips?: string[] }
> = {
  "find-money": {
    title: "Find me money (one wallet or a pasted list)",
    when: '"Here are my addresses, find me money." Any chains, ENS/.sol, mixed.',
    steps: [
      "One address: find_money {address}. Several: find_money_batch {addresses: <paste as-is>} → jobId. EVM addresses are scanned on every EVM chain automatically; Solana/Tron/Bitcoin/ENS/.sol are auto-detected.",
      "Poll find_money_status {jobId} every ~15s (scans can take minutes). Tell the user progress if it's slow ('3/7 wallets, ~$410 so far').",
      "Confirm the top items: for each recovery package, re-run its evidence reads with read_chain (op=call, same address/function/args, blockTag) and check the value matches. Drop anything you can't reproduce.",
      "Relay `summary` verbatim (it has the total, ranked items, and short + full links), then walk `plan`: phase1_recover (highest $ first), phase2_protect (revokes via build_revoke_tx), phase3_swap (swapAll).",
      "No key / lost wallet app? signing_guide / recovery_guide first: user runs the local script, gives back public addresses, rescan.",
      ...SIGN_LOOP.map((s) => `For each recovery tx: ${s}`),
      "Then swap the freed funds: build_swap_link (short + full) or get_quote/compare_routes → build_swap_tx → verify_tx → human → sign → broadcast_tx → get_route_status.",
      "Finish with a recap: recovered $, tx hashes with explorer links, what's left.",
    ],
    tips: [
      "Unknown contracts in history that return money come back with ABI fragments: use read_chain op=call to probe view functions (pending*, earned, dividendsOf, balanceOf) before proposing a tx.",
      "Never count 'protected' (atRiskUsd) as found money.",
    ],
  },
  "best-swap": {
    title: "Best swap",
    when: "User wants to swap X for Y (any chains).",
    steps: [
      "token_risk on the destination if it's not a blue chip.",
      "compare_routes (or get_quote) with fromChain/fromToken/amount/toChain/toToken; pass recipient for cross-VM.",
      "Pick best net-of-gas route; tell the user why (net output, ETA, fees).",
      "build_swap_tx {quoteId} → unsigned tx. If an approval is needed, verify it isn't unlimited unless the user wants that.",
      ...SIGN_LOOP,
      "Cross-chain: get_route_status until delivered. Also offer build_swap_link (short + full) if the user prefers the website.",
    ],
  },
  rebalance: {
    title: "Rebalance a portfolio",
    when: "User gives target weights.",
    steps: [
      "get_wallet_balances to show the current mix.",
      "rebalance_plan {address, targets, minTradeUsd} → list of quoted swaps.",
      "Present the plan; human approves the plan, THEN each tx individually.",
      "For each swap: build_swap_tx → verify_tx → human yes → sign → broadcast_tx → tx_status. Or one batch build_swap_link items[] (short + full).",
    ],
  },
  "revoke-approvals": {
    title: "Revoke risky approvals",
    when: "Security cleanup, after a drainer scare, or find_money flagged approvals.",
    steps: [
      "check_approvals {address} (find_money also lists them).",
      "Rank by exposure (allowance × balance) and spender risk (contract_reader on unknown spenders).",
      "build_revoke_tx for each → verify_tx (should be approve(spender,0)) → human yes → sign → broadcast_tx → tx_status.",
      "Re-run check_approvals to prove it's gone.",
    ],
  },
  "bridge-stuck": {
    title: "Bridge transfer stuck",
    when: "Funds left chain A and didn't arrive.",
    steps: [
      "Get the source tx hash. bridge_doctor {hash, fromChainId}.",
      "read_chain op=receipt on the source chain to confirm it succeeded; op=logs on the destination if needed.",
      "Follow bridge_doctor advice (wait / claim on destination / refund). Any claim tx goes through the sign loop.",
      "Canonical L2 exits (Base/Optimism/Arbitrum) may need a prove + finalize on L1 after the challenge period: each is its own verified, human-approved tx.",
    ],
  },
  "token-safety": {
    title: "Safety check before buying a token",
    when: "User wants to ape into something.",
    steps: [
      "token_risk {chainId, address}: pass on level, flags and disclaimer verbatim.",
      "contract_reader: owner powers (mint, pause, blacklist, tax setters, upgrade), renounced?",
      "token_pools: liquidity depth and locks; whale_watch: dev selling.",
      "read_chain spot checks if anything is unclear (e.g. op=storage on the EIP-1967 slot, op=call owner()).",
      "If the user still wants it: best-swap workflow with a small size, simulate_swap first.",
    ],
  },
  "recover-old-wallet": {
    title: "Recover an old wallet (phrase, keystore, 2015 presale, wallet.dat)",
    when: '"I have an old file from 2015" / "I have the words but no app."',
    steps: [
      "NEVER ask for the phrase/key/file contents in chat. Explain why (logs, scams).",
      "recovery_guide {situation} (seed-phrase, missing-word, passphrase, keystore, presale, electrum, wallet-dat, …) → write/run the reference script LOCALLY OFFLINE with the user.",
      "The script prints PUBLIC addresses only (all common derivation paths). Paste those into find_money_batch.",
      "Then the find-money workflow. Signing happens locally (same script or an imported wallet), after verify_tx and an explicit human yes; broadcast_tx relays the signed bytes.",
    ],
  },
};

export function playbook(workflow?: string, full = false) {
  const w = workflow?.toLowerCase().replace(/[_\s]/g, "-");
  if (w && w !== "full" && !WORKFLOWS[w])
    return { error: `unknown workflow ${workflow}`, workflows: Object.keys(WORKFLOWS) };
  const pick = full || !w || w === "full" ? WORKFLOWS : { [w]: WORKFLOWS[w]! };
  return {
    title: "SwapChan agent playbook: how to use every tool together",
    northStar:
      "SwapChan is the Swiss Army knife for agents and crypto: find the money, recover the key, read the chain, verify the tx, get the human's yes, broadcast, swap. Free and non-custodial.",
    principles: PRINCIPLES,
    ...(full || !w || w === "full" ? { catalog: CATALOG } : {}),
    workflows: pick,
    available: Object.keys(WORKFLOWS),
    page: "https://swapchan.com/agents/playbook",
  };
}

/** Compact text for the MCP server `instructions` field. */
export function playbookInstructions() {
  return [
    "SwapChan: the free, non-custodial Swiss Army knife for agents and crypto. Start with swapchan_playbook (workflow=find-money | best-swap | rebalance | revoke-approvals | bridge-stuck | token-safety | recover-old-wallet, or full=true).",
    `Principles: ${PRINCIPLES.join(" ")}`,
    "Find me money: one wallet → find_money; a pasted list → find_money_batch then poll find_money_status, relay `summary` verbatim, walk `plan`. Confirm evidence with read_chain. For each tx: verify_tx → human yes → user's wallet signs → broadcast_tx → tx_status. Then swap: build_swap_link or get_quote/compare_routes → build_swap_tx → verify_tx → sign → broadcast_tx.",
    `Tools: ${CATALOG.map((c) => c.tool).join(", ")}.`,
    "Every result carries chain-chan mascots and a `display` markdown block: show it to the user. Partner earning: https://swapchan.com/agents#earn",
  ].join("\n");
}
