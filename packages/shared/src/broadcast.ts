/**
 * broadcast_tx chain table: the one source of truth for which chains SwapChan can RELAY an already-signed
 * transaction to (API route, MCP tool description and enum, /chains/<slug> capability line, docs).
 * SwapChan never signs, never builds keys and cannot alter signed bytes; every endpoint below is a free public
 * node or explorer. Each endpoint was checked live with a read-only call (status/version/chainId) on 2026-10-26;
 * nothing was ever broadcast by those checks.
 */
export type BroadcastFamily =
  | "evm"
  | "solana"
  | "tron"
  | "bitcoin"
  | "utxo"
  | "xrp"
  | "stellar"
  | "algorand"
  | "cosmos"
  | "polkadot"
  | "ton"
  | "cardano";

export type BroadcastChain = {
  /** stable key accepted as `chainId` by /onchain/broadcast (numeric chain ids also accepted for EVM) */
  key: string;
  name: string;
  family: BroadcastFamily;
  /** EVM chain id (EVM only); the signed tx must carry exactly this id */
  chainId?: number;
  /** /chains/<slug> page for this chain, when one exists */
  slug?: string;
  /** relay endpoints, tried in order (public, keyless) */
  endpoints: string[];
  /** UTXO explorer API flavour */
  api?: "blockbook" | "insight" | "woc";
  /** explorer tx URL prefix; the hash is appended */
  explorerTx?: string;
  /** the raw format the caller must send */
  format: string;
};

const evm = (
  key: string,
  name: string,
  chainId: number,
  endpoints: string[],
  explorerTx?: string,
): BroadcastChain => ({
  key,
  name,
  family: "evm",
  chainId,
  endpoints,
  ...(explorerTx ? { explorerTx } : {}),
  format: "signed raw hex 0x… with EIP-155 chainId",
});
const bb = (key: string, name: string, slug: string, url: string): BroadcastChain => ({
  key,
  name,
  family: "utxo",
  slug,
  api: "blockbook",
  endpoints: [url],
  explorerTx: `${url}/tx/`,
  format: "signed raw tx hex",
});

/** The 12 chains broadcast_tx already supported (handled by the core paths in txtools.ts). */
export const BROADCAST_CORE: BroadcastChain[] = [
  { ...evm("1", "Ethereum", 1, ["RPC_URL_1 / publicnode / viem default"]), slug: "ethereum" },
  evm("8453", "Base", 8453, ["RPC_URL_8453 / publicnode / viem default"]),
  evm("42161", "Arbitrum One", 42161, ["RPC_URL_42161 / publicnode / viem default"]),
  evm("10", "OP Mainnet", 10, ["RPC_URL_10 / publicnode / viem default"]),
  evm("137", "Polygon PoS", 137, ["RPC_URL_137 / publicnode / viem default"]),
  evm("56", "BNB Smart Chain", 56, ["RPC_URL_56 / publicnode / viem default"]),
  evm("43114", "Avalanche C-Chain", 43114, ["RPC_URL_43114 / viem default"]),
  evm("59144", "Linea", 59144, ["RPC_URL_59144 / viem default"]),
  evm("534352", "Scroll", 534352, ["RPC_URL_534352 / viem default"]),
  {
    key: "solana",
    name: "Solana",
    family: "solana",
    slug: "solana",
    endpoints: ["Solana RPC sendTransaction"],
    format: "signed tx base64",
  },
  {
    key: "bitcoin",
    name: "Bitcoin",
    family: "bitcoin",
    slug: "bitcoin",
    endpoints: ["https://mempool.space/api/tx"],
    format: "signed raw tx hex (not a PSBT)",
  },
  {
    key: "tron",
    name: "Tron",
    family: "tron",
    slug: "tron",
    endpoints: ["https://api.trongrid.io/wallet/broadcasttransaction"],
    format: "signed Tron tx JSON",
  },
];

/** Chains added beyond the core 12. */
export const BROADCAST_EXTRA: BroadcastChain[] = [
  // ---- more EVM chains (the ones find_money scans); eth_chainId checked on every endpoint ----
  evm(
    "324",
    "zkSync Era",
    324,
    ["https://mainnet.era.zksync.io"],
    "https://explorer.zksync.io/tx/",
  ),
  evm(
    "100",
    "Gnosis",
    100,
    ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com"],
    "https://gnosisscan.io/tx/",
  ),
  evm(
    "5000",
    "Mantle",
    5000,
    ["https://mantle-rpc.publicnode.com", "https://rpc.mantle.xyz"],
    "https://mantlescan.xyz/tx/",
  ),
  evm(
    "42220",
    "Celo",
    42220,
    ["https://celo-rpc.publicnode.com", "https://forno.celo.org"],
    "https://celoscan.io/tx/",
  ),
  evm(
    "81457",
    "Blast",
    81457,
    ["https://blast-rpc.publicnode.com", "https://rpc.blast.io"],
    "https://blastscan.io/tx/",
  ),
  evm(
    "80094",
    "Berachain",
    80094,
    ["https://berachain-rpc.publicnode.com", "https://rpc.berachain.com"],
    "https://berascan.com/tx/",
  ),
  evm(
    "146",
    "Sonic",
    146,
    ["https://sonic-rpc.publicnode.com", "https://rpc.soniclabs.com"],
    "https://sonicscan.org/tx/",
  ),
  evm(
    "130",
    "Unichain",
    130,
    ["https://unichain-rpc.publicnode.com", "https://mainnet.unichain.org"],
    "https://uniscan.xyz/tx/",
  ),
  evm(
    "250",
    "Fantom",
    250,
    ["https://rpcapi.fantom.network"],
    "https://explorer.fantom.network/transactions/",
  ),
  evm("143", "Monad", 143, ["https://rpc.monad.xyz"], "https://monadscan.com/tx/"),
  evm("747474", "Katana", 747474, ["https://rpc.katana.network"], "https://katanascan.com/tx/"),
  evm("999", "HyperEVM", 999, ["https://rpc.hyperliquid.xyz/evm"], "https://hyperevmscan.io/tx/"),
  evm(
    "61",
    "Ethereum Classic",
    61,
    ["https://etc.etcdesktop.com", "https://geth-at.etc-network.info"],
    "https://etc.blockscout.com/tx/",
  ),
  evm("10001", "EthereumPoW", 10001, ["https://mainnet.ethereumpow.org"]),
  // ---- Bitcoin forks and old coins (Blockbook /api/v2/sendtx, Insight /tx/send, WhatsOnChain /tx/raw) ----
  bb("bch", "Bitcoin Cash", "bitcoin-cash", "https://blockbook.bch.zelcore.io"),
  bb("btg", "Bitcoin Gold", "bitcoin-gold", "https://btgexplorer.com"),
  bb("ltc", "Litecoin", "litecoin", "https://blockbook.ltc.zelcore.io"),
  bb("doge", "Dogecoin", "dogecoin", "https://blockbook.doge.zelcore.io"),
  bb("ftc", "Feathercoin", "feathercoin", "https://explorer.feathercoin.com"),
  bb("dash", "Dash", "dash", "https://blockbook.dash.zelcore.io"),
  bb("dgb", "DigiByte", "digibyte", "https://blockbook.dgb.zelcore.io"),
  bb("rvn", "Ravencoin", "ravencoin", "https://blockbook.rvn.zelcore.io"),
  bb("vtc", "Vertcoin", "vertcoin", "https://blockbook.vtc.zelcore.io"),
  bb("via", "Viacoin", "viacoin", "https://blockbook.viacoin.org"),
  bb("grs", "Groestlcoin", "groestlcoin", "https://blockbook.grs.zelcore.io"),
  bb("rdd", "Reddcoin", "reddcoin", "https://blockbook.reddcoin.com"),
  bb("ppc", "Peercoin", "peercoin", "https://blockbook.peercoin.net"),
  bb("zec", "Zcash (transparent)", "zcash", "https://blockbook.zec.zelcore.io"),
  {
    key: "bsv",
    name: "Bitcoin SV",
    family: "utxo",
    slug: "bitcoin-sv",
    api: "woc",
    endpoints: ["https://api.whatsonchain.com/v1/bsv/main"],
    explorerTx: "https://whatsonchain.com/tx/",
    format: "signed raw tx hex",
  },
  {
    key: "mona",
    name: "Monacoin",
    family: "utxo",
    slug: "monacoin",
    api: "insight",
    endpoints: ["https://mona.insight.monaco-ex.org/insight-api-monacoin"],
    format: "signed raw tx hex",
  },
  {
    key: "trc",
    name: "Terracoin",
    family: "utxo",
    slug: "terracoin",
    api: "insight",
    endpoints: ["https://insight.terracoin.io/api"],
    format: "signed raw tx hex",
  },
  // ---- account chains with a plain raw-tx submit API ----
  {
    key: "xrp",
    name: "XRP Ledger",
    family: "xrp",
    slug: "xrp-ledger",
    endpoints: ["https://xrplcluster.com", "https://s2.ripple.com:51234"],
    explorerTx: "https://livenet.xrpl.org/transactions/",
    format: "signed tx_blob hex",
  },
  {
    key: "xlm",
    name: "Stellar",
    family: "stellar",
    slug: "stellar",
    endpoints: ["https://horizon.stellar.org"],
    explorerTx: "https://stellar.expert/explorer/public/tx/",
    format: "signed TransactionEnvelope XDR base64",
  },
  {
    key: "algo",
    name: "Algorand",
    family: "algorand",
    slug: "algorand",
    endpoints: ["https://mainnet-api.algonode.cloud", "https://mainnet-api.4160.nodely.dev"],
    explorerTx: "https://allo.info/tx/",
    format: "signed transaction msgpack, base64",
  },
  {
    key: "atom",
    name: "Cosmos Hub",
    family: "cosmos",
    slug: "cosmos-hub",
    endpoints: [
      "https://cosmos-rest.publicnode.com",
      "https://rest.cosmos.directory/cosmoshub",
      "https://cosmos-api.polkachu.com",
    ],
    explorerTx: "https://www.mintscan.io/cosmos/tx/",
    format: "signed TxRaw protobuf bytes, base64",
  },
  {
    key: "dot",
    name: "Polkadot relay chain",
    family: "polkadot",
    slug: "polkadot",
    endpoints: ["https://rpc.polkadot.io", "https://polkadot-rpc.publicnode.com"],
    format: "signed extrinsic hex 0x…",
  },
  {
    key: "dot-assethub",
    name: "Polkadot Asset Hub",
    family: "polkadot",
    endpoints: ["https://polkadot-asset-hub-rpc.polkadot.io"],
    format: "signed extrinsic hex 0x…",
  },
  {
    key: "ton",
    name: "TON",
    family: "ton",
    slug: "ton",
    endpoints: ["https://toncenter.com/api/v2"],
    explorerTx: "https://tonviewer.com/transaction/",
    format: "signed external message BoC, base64",
  },
  {
    key: "ada",
    name: "Cardano",
    family: "cardano",
    slug: "cardano",
    endpoints: ["https://api.koios.rest/api/v1"],
    explorerTx: "https://cardanoscan.io/transaction/",
    format: "signed transaction CBOR hex",
  },
];

export const BROADCAST_CHAINS: BroadcastChain[] = [...BROADCAST_CORE, ...BROADCAST_EXTRA];
export const BROADCAST_COUNT = BROADCAST_CHAINS.length;

const FAMILY_LABEL: Record<string, string> = {
  evm: "EVM",
  utxo: "Bitcoin and Bitcoin-family/old coins",
  other: "Other ledgers",
};
const group = (c: BroadcastChain) =>
  c.family === "evm" ? "evm" : c.family === "bitcoin" || c.family === "utxo" ? "utxo" : "other";
/** "52 chains: EVM (23): Ethereum, …; Bitcoin family (19): …; Other ledgers (10): …" for descriptions and docs. */
export function broadcastSummary(): string {
  const parts = (["evm", "utxo", "other"] as const).map((g) => {
    const cs = BROADCAST_CHAINS.filter((c) => group(c) === g);
    return `${FAMILY_LABEL[g]} (${cs.length}): ${cs.map((c) => c.name).join(", ")}`;
  });
  return `${BROADCAST_COUNT} chains. ${parts.join("; ")}`;
}
/** chain page slugs where broadcast_tx can relay an already-signed tx */
export const BROADCAST_SLUGS = new Set(
  BROADCAST_CHAINS.map((c) => c.slug).filter((s): s is string => !!s),
);
