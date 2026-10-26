/**
 * /chains/<slug> pages: one address-format page per VERIFIED chain in the blocktools chain table. Every fact comes
 * from CHAIN_PAGE_ROWS (blocktools chainParams()); nothing here claims signing, sweeping or balances. Unverified rows
 * (addressValidate refuses them) get no page.
 */
import { CHAIN_PAGE_ROWS, type ChainPageRow } from "@swapchan/shared";

export type ChainPage = ChainPageRow & {
  h1: string;
  pageTitle: string;
  description: string;
  intro: string;
  formats: { label: string; detail: string }[];
  notes: string[];
  faq: { q: string; a: string }[];
  /** other verified chains whose legacy addresses use the same version byte (look-alikes) */
  lookAlikes: { slug: string; title: string }[];
  related: string[];
};

const SITE = "https://swapchan.com";
const SAFE =
  "Yes. An address is public. The checker only reads the string you paste; nothing is stored, and it never asks for a private key or seed phrase.";

/** Short, chain-specific format notes for the non-Bitcoin-family chains (facts about the public address format). */
const ACCOUNT: Record<string, { format: string; detail: string; tool?: string }> = {
  eth: {
    format: "0x + 40 hex characters",
    detail:
      "The last 20 bytes of the keccak-256 hash of the public key, written as hex. Mixed case is the EIP-55 checksum: a wrong capital letter means a typo. All-lowercase addresses are valid but carry no checksum. The same address works on every EVM chain.",
    tool: "evm-abi",
  },
  tron: {
    format: "Base58Check, starts with T, 34 characters",
    detail:
      "Byte 0x41 followed by the same 20-byte keccak hash Ethereum uses, encoded in Base58Check. That is why every Tron address starts with T.",
    tool: "tron-tx",
  },
  xrp: {
    format: "Ripple Base58, starts with r",
    detail:
      "A 20-byte account ID in Base58Check with XRP Ledger's own alphabet (it starts with r and differs from Bitcoin's alphabet), so a Bitcoin decoder will reject it. Exchanges often add a separate destination tag; that is not part of the address.",
  },
  atom: {
    format: "bech32 with the cosmos prefix",
    detail:
      "A 20-byte account hash in bech32 with the human-readable part cosmos (cosmos1…). Other Cosmos SDK chains reuse the same hash with their own prefix.",
  },
  algo: {
    format: "58 characters of base32",
    detail:
      "The 32-byte ed25519 public key plus a 4-byte SHA-512/256 checksum, encoded as 58 upper-case base32 characters.",
  },
  dot: {
    format: "SS58, network prefix 0 (starts with 1)",
    detail:
      "A 32-byte sr25519 public key in SS58 with network prefix 0, which makes Polkadot addresses start with 1. The same key shows a different string on Kusama (prefix 2) or generic Substrate (prefix 42, starts with 5).",
    tool: "ss58",
  },
  ksm: {
    format: "SS58, network prefix 2 (starts with a capital letter)",
    detail:
      "The same 32-byte sr25519 public key as Polkadot, in SS58 with network prefix 2, so Kusama addresses start with a capital letter such as C, D, E, F, G, H or J. One key gives a different string on each Substrate network.",
    tool: "ss58",
  },
  polyx: {
    format: "SS58, network prefix 12 (starts with 2)",
    detail:
      "A 32-byte sr25519 public key in SS58 with network prefix 12, so Polymesh addresses start with 2. The same key shows a different string on Polkadot (prefix 0) or Kusama (prefix 2).",
    tool: "ss58",
  },
  ada: {
    format: "bech32 with the addr prefix (Shelley)",
    detail:
      "Shelley-era base addresses are bech32 with the prefix addr, carrying a payment key hash and a stake key hash, which is why they are long. Older Byron addresses (Ae2…, DdzFF…) are a different format.",
  },
  ton: {
    format: "user-friendly base64url, 48 characters",
    detail:
      "Workchain, 32-byte account hash, flags and a CRC16 checksum in base64url. EQ… is bounceable and UQ… non-bounceable; both point at the same account.",
  },
  xlm: {
    format: "StrKey, starts with G, 56 characters",
    detail:
      "The 32-byte ed25519 public key in Stellar's StrKey base32 encoding with a version byte and CRC16 checksum, so account addresses start with G. A memo, if an exchange asks for one, is separate.",
  },
  sol: {
    format: "Base58, 32 bytes (usually 43 or 44 characters)",
    detail:
      "The raw 32-byte ed25519 public key in Base58, with no checksum, so a typo can still decode. Program-derived addresses look the same but are off the curve.",
    tool: "solana-pda",
  },
  aptos: {
    format: "0x + 64 hex characters",
    detail:
      "The SHA3-256 hash of the 32-byte ed25519 public key followed by the scheme byte 0x00, written as hex. There is no checksum, so a typo still looks valid; short forms such as 0x1 are special system accounts.",
  },
  sui: {
    format: "0x + 64 hex characters",
    detail:
      "The BLAKE2b-256 hash of the signature-scheme flag byte (0x00 for ed25519) followed by the public key, written as hex. There is no checksum, and an Aptos address has the same shape, so the detector can list both.",
  },
  near: {
    format: "64 lowercase hex characters (implicit account)",
    detail:
      "An implicit NEAR account is the 32-byte ed25519 public key itself, written as 64 lowercase hex characters with no 0x. Named accounts such as alice.near also exist; this checker covers implicit accounts only.",
  },
  xtz: {
    format: "Base58Check, starts with tz1 (36 characters)",
    detail:
      "The 20-byte BLAKE2b hash of the ed25519 public key with the tz1 prefix bytes, in Base58Check. tz2 and tz3 are secp256k1 and P-256 accounts, and KT1 is a smart contract.",
  },
  egld: {
    format: "bech32 with the erd prefix",
    detail:
      "The raw 32-byte ed25519 public key in bech32 with the human-readable part erd, so MultiversX addresses start with erd1 and are 62 characters long.",
  },
  xmr: {
    format: "Monero Base58, starts with 4 (95 characters)",
    detail:
      "A network byte, public spend key and public view key with a keccak checksum, in Monero's block-wise Base58. Standard addresses start with 4, subaddresses with 8.",
  },
};

/** Cosmos SDK rows without a hand-written note: the same bech32 shape, only the prefix (and for Ethermint chains the
 * hash) differs. Facts come from the row (hrp, SLIP-44 coin type). */
function accountInfo(
  r: ChainPageRow,
): { format: string; detail: string; tool?: string } | undefined {
  const a = ACCOUNT[r.name];
  if (a || r.family === "utxo" || !r.hrp) return a;
  if (r.slip44 === 60)
    return {
      format: `bech32 with the ${r.hrp} prefix (Ethermint)`,
      detail: `The last 20 bytes of the keccak-256 hash of the public key, the same bytes as the account's 0x Ethereum address, in bech32 with the human-readable part ${r.hrp} (${r.hrp}1…). The 0x and ${r.hrp}1 forms are one account written two ways.`,
    };
  return {
    format: `bech32 with the ${r.hrp} prefix`,
    detail: `A 20-byte account hash (RIPEMD-160 of SHA-256 of the public key) in bech32 with the human-readable part ${r.hrp} (${r.hrp}1…). Other Cosmos SDK chains use the same hash with their own prefix, so one key has a different address on each chain.`,
  };
}

const hex = (b: number[]) => b.map((x) => `0x${x.toString(16).padStart(2, "0")}`).join(" ");
const dec = (b: number[]) => b.join(", ");
const plainTitle = (t: string) => t.replace(/\s*\(.*?\)/, "").replace(/\s*\/.*$/, "");

function build(r: ChainPageRow, all: readonly ChainPageRow[]): ChainPage {
  const name = plainTitle(r.title);
  const utxo = r.family === "utxo";
  const formats: { label: string; detail: string }[] = [];
  const ex = (k: string) => r.examples.find((e) => e.kind.toLowerCase() === k)?.address;
  if (utxo) {
    const p2pkh = ex("p2pkh");
    const p2sh = ex("p2sh");
    formats.push({
      label: "Legacy (P2PKH)",
      detail: `Base58Check with version byte ${dec(r.p2pkh ?? [])} (${hex(r.p2pkh ?? [])})${p2pkh ? `; for example ${p2pkh.slice(0, 1)}…` : ""}.`,
    });
    if (r.p2sh?.length)
      formats.push({
        label: "Script (P2SH)",
        detail: `Base58Check with version byte ${dec(r.p2sh)} (${hex(r.p2sh)})${p2sh ? `; for example ${p2sh.slice(0, 1)}…` : ""}.`,
      });
    if (r.hrp)
      formats.push({
        label: "Native SegWit (bech32)",
        detail: `Human-readable part ${r.hrp}, so SegWit addresses start with ${r.hrp}1.`,
      });
    if (r.name === "bch")
      formats.push({
        label: "CashAddr",
        detail:
          "bitcoincash:q… / p…, the same hash as the legacy form. Use the CashAddr converter to switch.",
      });
    formats.push({
      label: "Checksum",
      detail:
        r.checksum === "groestl512d"
          ? "Groestl-512 (double), not Bitcoin's double SHA-256, so a Bitcoin decoder rejects valid Groestlcoin addresses."
          : "Double SHA-256, as in Bitcoin.",
    });
  } else {
    const a = accountInfo(r);
    if (a) formats.push({ label: a.format, detail: a.detail });
  }
  const lookAlikes =
    utxo && r.p2pkh
      ? all
          .filter(
            (o) =>
              o.name !== r.name &&
              o.verified &&
              o.family === "utxo" &&
              JSON.stringify(o.p2pkh) === JSON.stringify(r.p2pkh),
          )
          .map((o) => ({ slug: o.slug, title: plainTitle(o.title) }))
      : [];
  const notes: string[] = [];
  notes.push(
    `${r.ticker} amounts use ${r.decimals} decimal places: 1 ${r.ticker} = 10^${r.decimals} base units.`,
  );
  if (r.slip44 !== null)
    notes.push(
      `Its SLIP-44 coin type is ${r.slip44}, so BIP-44 style wallets derive it under m/44'/${r.slip44}'/….`,
    );
  if (lookAlikes.length)
    notes.push(
      `Its legacy addresses share version byte ${dec(r.p2pkh ?? [])} with ${lookAlikes.map((l) => l.title).join(", ")}, so the same string can be valid on ${lookAlikes.length === 1 ? "both chains" : "all of them"}. The detector lists every match; the right chain is the one your wallet uses.`,
    );
  if (r.forkid !== null)
    notes.push(
      `It signs with SIGHASH_FORKID (fork id ${r.forkid}), which is what stops transactions replaying on Bitcoin.`,
    );
  if (r.tx_format === "pos-ntime")
    notes.push(
      "It is a proof-of-stake era coin whose transactions carry a timestamp field, so generic Bitcoin decoders misread them.",
    );
  if (r.scope === "transparent")
    notes.push(
      "Only transparent addresses (t1…, t3…) are covered. Shielded addresses (z…, u…) are not.",
    );
  if (r.name === "bch" || r.name === "bsv")
    notes.push(
      "The legacy form is byte-for-byte a Bitcoin address, so a Bitcoin address validates here too. Only the chain you send on decides where the coins go.",
    );
  const exampleText = r.examples[0]
    ? ` Try it with the public example ${r.examples[0].address}.`
    : "";
  const formatShort = utxo
    ? `Base58Check (version byte ${dec(r.p2pkh ?? [])}${r.p2sh?.length ? ` / ${dec(r.p2sh)}` : ""})${r.hrp ? ` and bech32 (${r.hrp}1…)` : ""}`
    : (accountInfo(r)?.format ?? "native");
  const faq = [
    {
      q: `How do I check a ${name} address is valid?`,
      a: `Paste it into the checker on this page. It verifies the checksum and the ${utxo ? "version byte or bech32 prefix" : "encoding"} for ${name} and says which address type it is, or why it fails.`,
    },
    {
      q: `What does a ${name} address look like?`,
      a: `${formatShort}.${exampleText}`,
    },
    { q: `Is it safe to paste my ${name} address?`, a: SAFE },
    {
      q: `How many decimals does ${r.ticker} have?`,
      a: `${r.decimals}. The smallest unit is 1/10^${r.decimals} ${r.ticker}.`,
    },
  ];
  if (lookAlikes.length)
    faq.push({
      q: `Why does my ${name} address also show as ${lookAlikes[0]?.title}?`,
      a: `Both chains use version byte ${dec(r.p2pkh ?? [])} for legacy addresses, so the string is valid on each. The key behind it is the same; only the network differs.`,
    });
  const related = ["validate-address", "chain-params"];
  if (utxo) related.push("convert-address", "xpub-addresses", "address-script");
  if (r.name === "bch") related.push("cashaddr");
  const t = accountInfo(r)?.tool;
  if (t) related.push(t);
  return {
    ...r,
    h1: `${name} (${r.ticker}) address validator`,
    pageTitle: `${name} Address Validator & Format (${r.ticker}) | SwapChan`,
    description: `Check a ${name} (${r.ticker}) address: ${formatShort}, ${r.decimals} decimals. Free, public data only, no keys.`,
    intro: `Paste a ${name} address to check its checksum and format and see which address type it is. Below: how ${r.ticker} addresses are built, an example, and the chains it can be confused with.`,
    formats,
    notes,
    faq,
    lookAlikes,
    related,
  };
}

/** Verified chains only: unverified rows are refused by addressValidate, so a live checker page would be empty. */
export const CHAIN_PAGES: ChainPage[] = CHAIN_PAGE_ROWS.filter((r) => r.verified).map((r) =>
  build(r, CHAIN_PAGE_ROWS),
);
export const chainPage = (slug: string) => CHAIN_PAGES.find((c) => c.slug === slug);
export const chainHref = (c: { slug: string }) => `/chains/${c.slug}`;
export const CHAIN_FAMILIES: { id: string; label: string; match: (c: ChainPage) => boolean }[] = [
  { id: "bitcoin-family", label: "Bitcoin family (UTXO)", match: (c) => c.family === "utxo" },
  { id: "account", label: "Account-based chains", match: (c) => c.family !== "utxo" },
];

/** JSON-LD for a chain page. Like the tool pages, it never names the library (tests forbid it). */
export function chainLd(c: ChainPage, site = SITE) {
  const url = `${site}${chainHref(c)}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: c.h1,
      url,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: c.description,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: c.faq.map((f) => ({
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
        { "@type": "ListItem", position: 2, name: "Chains", item: `${site}/chains` },
        { "@type": "ListItem", position: 3, name: c.h1, item: url },
      ],
    },
  ];
}
