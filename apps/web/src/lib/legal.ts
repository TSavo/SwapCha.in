/** Plain-language legal text for /terms and /privacy. No placeholders remain (legal.test.ts checks). */
export type LegalSection = { h: string; p: string[] };
export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] };

export const LEGAL_PLACEHOLDERS: readonly string[] = [];

export const FEE_RECIPIENT = "0xeb0eC7a28E4B6B175806E21D9D3afE45792C5c7B";

export const TERMS: LegalDoc = {
  title: "Terms of Use",
  updated: "October 25, 2026",
  intro:
    "SwapChan (swapchan.com, api.swapchan.com and mcp.swapchan.com) is a trustless toolkit for people and AI agents working with crypto. It is operated by T Savo. By using it you agree to these terms. If you don't agree, don't use it.",
  sections: [
    {
      h: "What SwapChan is",
      p: [
        "SwapChan reads public blockchain data, compares quotes from third-party providers and builds unsigned transactions. Your wallet decides whether to sign them.",
        "SwapChan never signs a transaction and never holds your keys or funds. It cannot move your money. The optional broadcast_tx tool only relays a transaction you have already signed, unchanged.",
        "There are no accounts. You don't sign up to use the site, the API or the MCP server.",
      ],
    },
    {
      h: "You verify and sign",
      p: [
        "Before you sign anything, check what your wallet shows you: the chain, the contract, the function, the amount and the recipient. If it doesn't match what you intended, don't sign it.",
        "Blockchain transactions are final. Once signed and confirmed, a transaction cannot be reversed by SwapChan or anyone else.",
        "You are responsible for your wallet, your keys, your seed phrase and every transaction you sign.",
      ],
    },
    {
      h: "Third-party providers",
      p: [
        "Swap and bridge routes come from third parties such as 0x, CoW Protocol, LI.FI, Across, Relay, deBridge, KyberSwap, 1inch, Velora, Jupiter and THORChain. Balances, prices and other data come from public blockchain nodes, block explorers and data services.",
        "SwapChan doesn't control these providers. Their quotes, contracts, prices, uptime and data can be wrong, change or fail. Their own terms apply when you use their contracts.",
      ],
    },
    {
      h: "Fee",
      p: [
        `Swaps routed through SwapChan carry a 0.1% (10 bps) fee, paid to ${FEE_RECIPIENT} and included in the quote you see before you sign. Only swaps carry this fee.`,
        "Network gas and any fees the third-party provider charges are separate and shown by the provider or your wallet.",
      ],
    },
    {
      h: "Recovery and find-money tools",
      p: [
        'The find-money, recover and "Get it back" tools are best-effort. A scan can miss funds, a check can time out (it says "not checked" when it does), and a found balance may not be claimable.',
        "Claims and sweeps are irreversible transactions you sign yourself. Check each one before signing. SwapChan never asks for your seed phrase or private key; never paste them into any website.",
      ],
    },
    {
      h: "No advice",
      p: [
        "Nothing on SwapChan is financial, investment, tax or legal advice. Token data, scanner results, risk flags and rankings are information, not recommendations. Memecoins and new tokens can go to zero.",
      ],
    },
    {
      h: "Acceptable use",
      p: [
        "Don't use SwapChan to break the law, to get around sanctions, or to attack, overload or scrape the service beyond its published rate limits. Requests may be rate-limited or refused.",
        "You are responsible for following the laws that apply to you, including where crypto use is restricted.",
      ],
    },
    {
      h: "No warranty",
      p: [
        'SwapChan is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement.',
        "There is no guarantee of availability. Any tool, chain or provider may be changed, paused or removed at any time without notice.",
      ],
    },
    {
      h: "Limitation of liability",
      p: [
        "To the fullest extent the law allows, T Savo is not liable for any loss of funds, tokens, profits or data, or for any indirect, incidental or consequential damages, arising from your use of SwapChan, third-party providers, smart contracts or blockchains.",
        "Where liability can't be excluded, it is limited to the fees you paid SwapChan in the 12 months before the claim.",
      ],
    },
    {
      h: "Changes and law",
      p: [
        "These terms may change; the date above shows the latest version. Continuing to use SwapChan after a change means you accept it.",
        "These terms are governed by the laws of the State of California, USA. Disputes go to the state and federal courts located in California.",
        "Questions: evilgenius@nefariousplan.com",
      ],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  title: "Privacy Policy",
  updated: "October 25, 2026",
  intro:
    "SwapChan has no accounts and doesn't ask for your name or email. This page explains what the site, API and MCP server do with the data they do see. It is operated by T Savo.",
  sections: [
    {
      h: "Wallet addresses and public data",
      p: [
        "When you connect a wallet or type an address, that public address is sent to the SwapChan API to look up balances, quotes and history.",
        "To answer, SwapChan forwards the address (and, for quotes, the tokens and amounts) to the third-party services that hold the data: public blockchain nodes, block explorers (for example Etherscan, Blockscout, mempool.space, TronGrid and cryptoid), price and token-data services (for example DefiLlama, DexScreener, GoPlus and RugCheck) and swap providers (for example 0x, CoW Protocol, LI.FI, Across, Relay and Jupiter). Their own privacy policies apply.",
        "Wallet addresses and transactions are public on their blockchains by nature.",
      ],
    },
    {
      h: "What SwapChan stores",
      p: [
        "Batch find-money jobs: the addresses you submit and the results, kept up to 6 hours so the job can be resumed, then deleted.",
        "Short links: when SwapChan makes a short link, it stores the full link (which can contain an address or transaction), a click count and the time of the last click. A link not clicked for 12 months is deleted, along with its row in the daily backups once those roll over (14 days).",
        "Price watches you create: the tokens, thresholds and watch id, until you remove the watch or 12 months after it was created, whichever comes first.",
        "Partners: if you register as a partner, the name, site URL and payout address you give, plus each referred quote and swap (provider, chains, amounts, fee, the swap's transaction hash and the taker address) so the payout can be calculated. After 24 months the taker address is deleted and the transaction hash is replaced with a one-way digest; the amounts stay so payout totals don't change.",
        "Server logs record timings and errors, not request bodies. The developer-tools API doesn't log what you send it.",
      ],
    },
    {
      h: "IP addresses",
      p: [
        "Your IP address is used in memory to rate-limit requests (per minute for the tools API, per hour for partner signup). SwapChan doesn't write it to its logs or database.",
        "SwapChan is served through Cloudflare, which processes IP addresses and request data under its own privacy policy.",
      ],
    },
    {
      h: "Analytics",
      p: [
        "SwapChan uses Google Analytics 4 to count page views. Page views are sent manually after removing query strings, fragments and any path part that looks like an address, name or transaction hash, so Google doesn't receive those from SwapChan's page views.",
        "Google Analytics sets its own cookies and receives your IP address and browser details under Google's privacy policy. You can block it with a browser extension or Google's opt-out add-on without losing any SwapChan feature.",
      ],
    },
    {
      h: "Cookies and local storage",
      p: [
        "swapchan_ref: if you arrive through a partner's ?ref= link, the partner id is kept in a first-party cookie and local storage for 30 days so the partner gets credit.",
        "Local and session storage also remember small UI choices, such as a dismissed greeting and your last Tron wallet.",
        "Wallet connection uses Reown AppKit (WalletConnect), with AppKit's own analytics turned off. Connecting through WalletConnect sends connection data to Reown's relay under its policy.",
      ],
    },
    {
      h: "What SwapChan doesn't do",
      p: [
        "SwapChan never asks for, receives or stores private keys or seed phrases, and it doesn't sell or rent your data.",
      ],
    },
    {
      h: "Your choices and contact",
      p: [
        "You can use SwapChan without connecting a wallet, and block analytics without losing features. To ask about or delete data tied to a partner registration, short link or watch, write to evilgenius@nefariousplan.com.",
        "This policy may change; the date above shows the latest version.",
      ],
    },
  ],
};
