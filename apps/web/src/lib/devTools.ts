/**
 * Developer & chain tools (/tools/<slug>): pure functions on PUBLIC input, computed by the
 * blocktools wasm behind POST /tools/:fn. Never keys, seeds, signing or recovery.
 * SEO copy (titles, meta, H1) follows audits/tools-directory-plan.md §4.
 */
export const CHAIN_COUNT = 41; // chainParams() rows in the vendored wasm (asserted in api devtools.test.ts)
export const POWERED_BY = "This tool is powered by blocktools.";

export type Field = {
  name: string;
  label: string;
  kind?: "text" | "number" | "lines" | "select";
  options?: string[];
  placeholder?: string;
  optional?: boolean;
};
export type Mode = { id: string; label: string; fn: string; op?: string; fields: Field[] };
export type Example = { label: string; mode: string; values: Record<string, string> };
export type DevTool = {
  slug: string;
  name: string;
  emoji: string;
  mcp: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  body: string[];
  keywords: string[];
  faq: { q: string; a: string }[];
  modes: Mode[];
  examples: Example[];
  warning?: string;
  related: string[];
};

const chain = (optional = false): Field => ({
  name: "chain",
  label: "Chain (ticker, e.g. btc, ltc, doge)",
  placeholder: "btc",
  optional,
});
const address: Field = { name: "address", label: "Address", placeholder: "Paste an address" };
const SAFE_A =
  "Yes. It only reads public data you paste. Nothing is stored or logged, and you never need a private key or seed phrase here.";

export const DEV_TOOLS: DevTool[] = [
  {
    slug: "validate-address",
    name: "Address validator & chain detector",
    emoji: "✅",
    mcp: "address_tool",
    title: `Crypto Address Validator & Chain Detector, ${CHAIN_COUNT} chains | SwapChan`,
    description: "Check an address is valid and which chains it belongs to.",
    h1: "Validate any crypto address",
    intro: `Paste an address to see which of ${CHAIN_COUNT} supported chains and formats it fits, or check it against one chain.`,
    body: [
      "Many coins share address formats. A Bitcoin legacy address starting with 1 is byte-for-byte the same shape as addresses on several forks, and some prefixes overlap between chains. Detect mode lists every chain and address kind (P2PKH, P2SH, SegWit, Taproot and so on) that the string decodes as, so you can see when an address is ambiguous instead of guessing.",
      "Validate mode checks the address against one chain you pick and tells you the kind, or why it fails: wrong checksum, wrong version byte, wrong bech32 prefix. Use it before you send funds or paste an address into a sweep.",
    ],
    keywords: ["validate crypto address", "which blockchain is this address"],
    faq: [
      {
        q: "What does the address validator check?",
        a: "The checksum, the version byte or bech32 prefix, and the payload length for the chain you pick. Detect mode tries every supported chain.",
      },
      { q: "Is it safe to paste my address?", a: SAFE_A },
      {
        q: "Why does one address match several chains?",
        a: "Forks often reuse Bitcoin's version bytes, so the same string is a valid address on more than one chain. The detector shows all of them; the right one is the chain your wallet uses.",
      },
      {
        q: "Which formats are supported?",
        a: `Base58Check (P2PKH, P2SH), bech32 and bech32m (SegWit v0 and Taproot) and CashAddr across ${CHAIN_COUNT} chains.`,
      },
    ],
    modes: [
      { id: "detect", label: "Detect chain", fn: "detect-address", fields: [address] },
      {
        id: "validate",
        label: "Validate for a chain",
        fn: "validate-address",
        fields: [address, chain()],
      },
    ],
    examples: [
      {
        label: "Bitcoin genesis address",
        mode: "detect",
        values: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
      },
      {
        label: "Validate on Bitcoin",
        mode: "validate",
        values: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", chain: "btc" },
      },
    ],
    related: ["convert-address", "cashaddr", "chain-params"],
  },
  {
    slug: "convert-address",
    name: "Address converter",
    emoji: "🔁",
    mcp: "address_tool",
    title: "Convert Addresses Between Bitcoin-Family Chains | SwapChan",
    description: "Re-encode the same key hash for another chain.",
    h1: "Address converter",
    intro:
      "Re-encode the same key hash as an address on another Bitcoin-family chain, for example Litecoin 3… to M… or Bitcoin to Dogecoin.",
    body: [
      "Bitcoin-family addresses are a key or script hash wrapped in a chain-specific version byte or bech32 prefix. Converting keeps the hash and swaps the wrapper, so the result is controlled by the same key on the other chain.",
      "This is useful when Litecoin moved P2SH addresses from 3… to M…, when you need to see where a forked coin landed for a Bitcoin address, or when a tool only accepts one format. Converting an address does not move any coins.",
    ],
    keywords: ["convert litecoin address 3 to M", "dogecoin address converter"],
    faq: [
      {
        q: "Does converting an address move my coins?",
        a: "No. It only re-encodes the same hash. Coins stay where they are.",
      },
      { q: "Is it safe?", a: SAFE_A },
      {
        q: "Why convert a Litecoin 3 address to M?",
        a: "Litecoin introduced the M prefix for P2SH so it would not be confused with Bitcoin's 3 addresses. Both encode the same script hash.",
      },
      {
        q: "Which chains can I convert between?",
        a: `Any of the ${CHAIN_COUNT} chains in the chain parameters table that support the address kind.`,
      },
    ],
    modes: [
      {
        id: "convert",
        label: "Convert",
        fn: "convert-address",
        fields: [
          address,
          { name: "to", label: "To chain", placeholder: "ltc" },
          { name: "from", label: "From chain (if ambiguous)", placeholder: "btc", optional: true },
        ],
      },
    ],
    examples: [
      {
        label: "Bitcoin → Litecoin",
        mode: "convert",
        values: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", to: "ltc" },
      },
      {
        label: "Bitcoin → Dogecoin",
        mode: "convert",
        values: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", to: "doge" },
      },
    ],
    related: ["validate-address", "cashaddr", "chain-params"],
  },
  {
    slug: "cashaddr",
    name: "Bitcoin Cash address converter",
    emoji: "🟩",
    mcp: "address_tool",
    title: "CashAddr to Legacy Converter (Bitcoin Cash) | SwapChan",
    description: "Convert BCH addresses between CashAddr and legacy formats instantly.",
    h1: "Bitcoin Cash address converter",
    intro:
      "Convert Bitcoin Cash addresses between CashAddr (bitcoincash:q…) and legacy (1…/3…) formats, or decode a CashAddr.",
    body: [
      "Bitcoin Cash adopted the CashAddr format so BCH addresses could not be confused with Bitcoin ones. Old wallets, exchanges and paper wallets still show the legacy format. Both encode the same hash, so converting between them is safe and lossless.",
      "Decode mode shows the prefix, the type (P2PKH or P2SH) and the hash inside a CashAddr.",
    ],
    keywords: ["convert cashaddr to legacy", "bitcoin cash address converter"],
    faq: [
      {
        q: "Are CashAddr and legacy addresses the same wallet?",
        a: "Yes. They encode the same key or script hash; only the text format differs.",
      },
      { q: "Is it safe?", a: SAFE_A },
      {
        q: "Do I need the bitcoincash: prefix?",
        a: "No. The converter accepts CashAddr with or without the prefix and adds it in the output.",
      },
    ],
    modes: [
      {
        id: "to_legacy",
        label: "CashAddr → legacy",
        fn: "cashaddr",
        op: "to_legacy",
        fields: [address],
      },
      {
        id: "to_cashaddr",
        label: "Legacy → CashAddr",
        fn: "cashaddr",
        op: "to_cashaddr",
        fields: [address],
      },
      { id: "decode", label: "Decode CashAddr", fn: "cashaddr", op: "decode", fields: [address] },
    ],
    examples: [
      {
        label: "BCH genesis address → CashAddr",
        mode: "to_cashaddr",
        values: { address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
      },
      {
        label: "CashAddr → legacy",
        mode: "to_legacy",
        values: { address: "bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy" },
      },
    ],
    related: ["validate-address", "convert-address", "xpub-addresses"],
  },
  {
    slug: "xpub-addresses",
    name: "Xpub to addresses",
    emoji: "🌳",
    mcp: "xpub_addresses",
    title: "Xpub to Addresses: Derive Receive Addresses | SwapChan",
    description: "Public xpub only, never paste an xprv.",
    h1: "Derive addresses from an xpub",
    intro:
      "List the receive or change addresses behind an extended public key (xpub, ypub, zpub). Public keys only: private keys and seed phrases are refused.",
    warning:
      "Never paste an xprv or a seed phrase anywhere online. An xpub cannot spend, but it does reveal every address in the wallet, so treat it as private.",
    body: [
      "An extended public key derives a whole tree of addresses. Branch 0 holds receive addresses and branch 1 holds change. This tool derives up to 20 at a time for legacy (P2PKH), nested SegWit (P2SH-P2WPKH), native SegWit (P2WPKH) or Taproot (P2TR).",
      "Use it to find which addresses a hardware or watch-only wallet controls, to check a balance by address, or to confirm an xpub belongs to the wallet you think it does.",
    ],
    keywords: ["xpub to address", "derive addresses from xpub"],
    faq: [
      {
        q: "Is it safe to paste an xpub?",
        a: "An xpub cannot spend funds, but it reveals all of the wallet's addresses and history. Nothing is stored or logged here. Private keys (xprv, yprv, zprv, tprv) and seed phrases are rejected.",
      },
      {
        q: "Which address types are supported?",
        a: "P2PKH (1…), P2SH-P2WPKH (3…), P2WPKH (bc1q…) and P2TR (bc1p…), on Bitcoin-family chains.",
      },
      {
        q: "What are branch 0 and branch 1?",
        a: "Branch 0 is the external chain of receive addresses; branch 1 is internal change addresses.",
      },
      {
        q: "Why don't the addresses match my wallet?",
        a: "Check the address type. A zpub normally means native SegWit and a ypub nested SegWit; some wallets also use a different account path.",
      },
    ],
    modes: [
      {
        id: "derive",
        label: "Derive",
        fn: "xpub-addresses",
        fields: [
          { name: "xpub", label: "Extended public key (xpub / ypub / zpub)", placeholder: "xpub…" },
          chain(),
          {
            name: "kind",
            label: "Address type",
            kind: "select",
            options: ["p2pkh", "p2wpkh", "p2sh-p2wpkh", "p2tr"],
          },
          {
            name: "branch",
            label: "Branch (0 receive, 1 change)",
            kind: "select",
            options: ["0", "1"],
          },
          { name: "start", label: "Start index", kind: "number", placeholder: "0", optional: true },
          {
            name: "count",
            label: "How many (max 20)",
            kind: "number",
            placeholder: "10",
            optional: true,
          },
        ],
      },
    ],
    examples: [
      {
        label: "BIP32 test vector 1",
        mode: "derive",
        values: {
          xpub: "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
          chain: "btc",
          kind: "p2pkh",
          branch: "0",
          count: "5",
        },
      },
    ],
    related: ["validate-address", "convert-address", "chain-params"],
  },
  {
    slug: "ss58",
    name: "SS58 address converter",
    emoji: "🔴",
    mcp: "substrate_tool",
    title: "SS58 Address Converter (Polkadot/Kusama) | SwapChan",
    description: "Decode or re-encode Substrate addresses for any network prefix.",
    h1: "SS58 address converter",
    intro:
      "Decode a Polkadot, Kusama or other Substrate address to its public key and network prefix, or re-encode it for another network.",
    body: [
      "Substrate chains share one account key format and show it with a network-specific SS58 prefix: 0 for Polkadot, 2 for Kusama, 42 for generic Substrate and test networks. The same account looks different on each chain.",
      "Convert mode re-encodes an address for another prefix, so you can match a Polkadot address to its Kusama or parachain form. Encode mode builds an address from a 32-byte public key.",
    ],
    keywords: ["ss58 address converter", "polkadot address converter"],
    faq: [
      {
        q: "Is a Polkadot address the same account on Kusama?",
        a: "The public key is the same; only the SS58 prefix (and so the text) changes. Whether funds exist there depends on the chain.",
      },
      { q: "Is it safe?", a: SAFE_A },
      {
        q: "Which prefix do I need?",
        a: "0 is Polkadot, 2 is Kusama, 42 is generic Substrate. Parachains publish their own prefixes.",
      },
    ],
    modes: [
      {
        id: "convert",
        label: "Convert prefix",
        fn: "ss58",
        op: "convert",
        fields: [
          address,
          {
            name: "prefix",
            label: "Target prefix (0 Polkadot, 2 Kusama, 42 Substrate)",
            kind: "number",
            placeholder: "0",
          },
        ],
      },
      { id: "decode", label: "Decode", fn: "ss58", op: "decode", fields: [address] },
      {
        id: "encode",
        label: "Encode public key",
        fn: "ss58",
        op: "encode",
        fields: [
          { name: "account", label: "Public key (32-byte hex)", placeholder: "0x…" },
          { name: "prefix", label: "Prefix", kind: "number", placeholder: "0" },
        ],
      },
    ],
    examples: [
      {
        label: "Alice (dev) → Polkadot",
        mode: "convert",
        values: { address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", prefix: "0" },
      },
      {
        label: "Decode Alice",
        mode: "decode",
        values: { address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" },
      },
    ],
    related: ["validate-address", "solana-pda", "chain-params"],
  },
  {
    slug: "solana-pda",
    name: "Solana PDA & ATA calculator",
    emoji: "🟣",
    mcp: "solana_address",
    title: "Solana PDA & ATA Calculator | SwapChan",
    description: "Compute program-derived and associated token addresses.",
    h1: "Solana PDA calculator",
    intro:
      "Compute a program-derived address (PDA) and bump from seeds, find the associated token account (ATA) for a wallet and mint, or check whether an address is on the ed25519 curve.",
    body: [
      "Solana programs own accounts at program-derived addresses: a hash of seeds and the program id pushed off the ed25519 curve, so no private key exists for them. The bump is the first value that lands off-curve.",
      "An associated token account is a PDA of the Associated Token program over the owner, the token program and the mint. Use this to find where a wallet's tokens live, to debug a program, or to check a PDA your code expects.",
    ],
    keywords: ["solana pda calculator", "find associated token account"],
    faq: [
      {
        q: "What format do seeds use?",
        a: 'One seed per line, as hex bytes (for example 6d65746164617461 for the text "metadata"). Up to 16 seeds of 32 bytes each, as on-chain.',
      },
      { q: "Is it safe?", a: SAFE_A },
      {
        q: "What does on-curve mean?",
        a: "An on-curve address is a normal ed25519 public key that has a private key. PDAs are off-curve by design.",
      },
      {
        q: "Which token program does the ATA use?",
        a: "The classic SPL Token program by default. Pass the Token-2022 program id for Token-2022 mints.",
      },
    ],
    modes: [
      {
        id: "pda",
        label: "PDA from seeds",
        fn: "solana-pda",
        fields: [
          { name: "program", label: "Program id" },
          { name: "seeds", label: "Seeds (hex, one per line)", kind: "lines" },
        ],
      },
      {
        id: "ata",
        label: "Associated token account",
        fn: "solana-ata",
        fields: [
          { name: "owner", label: "Owner wallet" },
          { name: "mint", label: "Token mint" },
          { name: "token_program", label: "Token program (optional)", optional: true },
        ],
      },
      { id: "on_curve", label: "On-curve check", fn: "solana-on-curve", fields: [address] },
    ],
    examples: [
      {
        label: "USDC ATA",
        mode: "ata",
        values: {
          owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
      },
      {
        label: "Metadata PDA seeds",
        mode: "pda",
        values: {
          program: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
          seeds: "6d65746164617461",
        },
      },
    ],
    related: ["ss58", "validate-address", "chain-params"],
  },
  {
    slug: "chain-params",
    name: "Chain parameters table",
    emoji: "📋",
    mcp: "chain_params",
    title: `Crypto Chain Parameters: Address Version Bytes & Prefixes, ${CHAIN_COUNT} chains | SwapChan`,
    description: `Address version bytes, bech32 prefixes, WIF bytes and SLIP-44 coin types for ${CHAIN_COUNT} chains.`,
    h1: "Chain parameters table",
    intro: `Address version bytes, bech32 prefixes, WIF bytes, SLIP-44 coin types and checksum types for ${CHAIN_COUNT} chains, in one table.`,
    body: [
      "Every Bitcoin-family chain picks its own version bytes for P2PKH and P2SH addresses, its own bech32 human-readable part and its own WIF byte; other chains record their checksum and transaction format. These parameters are what the validator, converter and xpub tools on this site use.",
      "Look up one chain by ticker, or show the whole table.",
    ],
    keywords: ["address version bytes", "bech32 prefix"],
    faq: [
      {
        q: "What is a version byte?",
        a: "The first byte of a Base58Check address. It decides the leading character, for example 0 gives Bitcoin's 1… and 48 gives Litecoin's L….",
      },
      {
        q: "Where does the data come from?",
        a: "From the same parameter table the address tools use, so the page and the tools always agree.",
      },
      { q: "Is it safe?", a: "Yes. It shows public constants only." },
    ],
    modes: [{ id: "show", label: "Show", fn: "chain-params", fields: [chain(true)] }],
    examples: [
      { label: "Bitcoin", mode: "show", values: { chain: "btc" } },
      { label: "All chains", mode: "show", values: {} },
    ],
    related: ["validate-address", "convert-address", "xpub-addresses"],
  },
];

export const devTool = (slug: string): DevTool | undefined =>
  DEV_TOOLS.find((t) => t.slug === slug);

/** Request body for one run: only declared fields, typed; seeds split per line. */
export function buildInput(mode: Mode, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = mode.op ? { op: mode.op } : {};
  for (const f of mode.fields) {
    const v = (values[f.name] ?? "").trim();
    if (!v) continue;
    if (f.kind === "number" || (f.kind === "select" && f.name === "branch"))
      out[f.name] = Number(v);
    else if (f.kind === "lines") out[f.name] = v.split(/\s+/).filter(Boolean);
    else out[f.name] = v;
  }
  return out;
}

/** Same rule as the API: never send private extended keys or seed phrases. */
export function looksSecret(values: Record<string, string>): boolean {
  return Object.values(values).some(
    (v) =>
      /\b[xtyzuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{20,}/.test(v) ||
      /^([a-z]{3,8}\s+){11,23}[a-z]{3,8}$/.test(v.trim()),
  );
}

/** JSON-LD for one tool page: SoftwareApplication + FAQPage + BreadcrumbList. */
export function devToolLd(t: DevTool, site = "https://swapchan.com") {
  const url = `${site}/tools/${t.slug}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: t.h1,
      url,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: t.description,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: t.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Free tools", item: `${site}/tools` },
        { "@type": "ListItem", position: 2, name: t.name, item: url },
      ],
    },
  ];
}
