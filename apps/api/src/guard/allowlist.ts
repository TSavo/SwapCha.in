/**
 * Official router / spender addresses per provider. Sources (2026-10): provider docs and
 * deployment registries: 1inch v6 docs, KyberSwap MetaAggregationRouterV2 docs, Velora (ParaSwap)
 * Augustus v6.2/v5 docs, 0x AllowanceHolder docs, lifinance/contracts deployments/*.json,
 * across-protocol/contracts broadcast/deployed-addresses.json, Relay /chains API + RelayDepository
 * (CREATE2, same address on every EVM chain), deBridge DLN docs, CoW docs. THORChain routers and
 * Relay per-chain contracts are fetched live (see ctx.ts). All lowercase.
 */
export type ChainMap = Record<number | "*", string[]>;

const l = (xs: string[]) => xs.map((x) => x.toLowerCase());

export const EVM_ROUTERS: Record<string, Partial<ChainMap>> = {
  "1inch": { "*": l(["0x111111125421cA6dc452d289314280a0f8842A65"]) },
  kyberswap: { "*": l(["0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"]) },
  velora: {
    "*": l([
      "0x6a000f20005980200259b80c5102003040001068", // Augustus v6.2
      "0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57", // Augustus v5
      "0x216B4B4Ba9F3e719726886d34a177484278Bfcae", // v5 TokenTransferProxy (spender)
    ]),
  },
  "0x": {
    "*": l([
      "0x0000000000001fF3684f28c67538d4D072C22734", // AllowanceHolder (Cancun chains)
      "0x0000000000005E88410CcDFaDe4a5EfaE4b49562", // AllowanceHolder (Shanghai chains)
    ]),
  },
  lifi: {
    "*": l(["0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"]),
    59144: l(["0xDE1E598b81620773454588B85D6b5D4eEC32573e"]),
  },
  across: {
    "*": l([
      "0x97CCDBea4632140639aD5eA9b944aa034eb15fD4", // SpokePoolPeriphery
      "0x3Fb9cED51E968594C87963a371Ed90c39519f65A", // SpokePoolVerifier
    ]),
    1: l(["0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5"]),
    10: l(["0x6f26Bf09B1C792e3228e5467807a900A503c0281"]),
    56: l(["0x4e8E101924eDE233C13e2D8622DC8aED2872d505"]),
    137: l(["0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096"]),
    8453: l(["0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64"]),
    42161: l(["0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A"]),
    43114: l(["0xFE9D541c92E4e90437C7152A00244886dE37a658"]),
    59144: l(["0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75"]),
    534352: l(["0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96"]),
  },
  relay: {
    "*": l([
      "0x4cD00E387622C35bDDB9b4c962C136462338BC31", // RelayDepository
      "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f", // v3 erc20Router
      "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be", // v3 approvalProxy
      "0x0729e2a4716d9f7dd17858d5d504426d228697f7", // v3.2 erc20Router
      "0x5567954cd026cebfe486062cb75848e0f1c12e58", // v3.2 approvalProxy
      "0xa5f565650890fba1824ee0f21ebbbf660a179934", // relayReceiver
    ]),
    59144: l([
      "0x9ef6d3c2f60d7b9008d74cab1fc0f899c957c819",
      "0x8754bc615047de01228a7527b712806a71a8dc9a",
      "0x6328ea02d28131e58b28e55c6258258a30d90e05",
      "0xe4dfbd5e6784db1058124e2c87554c0591f0fb7b",
      "0x00000000aa467eba42a3d604b3d74d63b2b6c6cb",
    ]),
  },
  debridge: {
    "*": l([
      "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // DlnSource
      "0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251", // CrosschainForwarder
    ]),
  },
  cow: {
    "*": l([
      "0x9008D19f58AAbD9eD0D60971565AA8510560ab41", // GPv2Settlement
      "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110", // GPv2VaultRelayer (spender)
      "0xba3cb449bd2b4adddbc894d8697f5170800eadec", // EthFlow
    ]),
  },
  // thorchain: routers come only from live inbound_addresses.
};

export const COW_SETTLEMENT = "0x9008d19f58aabd9ed0d60971565aa8510560ab41";

/** Solana programs a returned transaction may invoke. */
export const SVM_PROGRAMS: Record<string, string> = {
  ComputeBudget111111111111111111111111111111: "ComputeBudget",
  "11111111111111111111111111111111": "System",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo v2",
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: "Memo v1",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
  "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2": "Relay",
  src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4: "deBridge DLN source",
  DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh: "deBridge",
  "3i5JeuZuUxeKtVysUnwQNGerJP2bSMX9fTFfS4Nxe3Br": "LI.FI",
  proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u: "OKX DEX router (LI.FI)",
  DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH: "DFlow (LI.FI)",
};

/** Fee wallets a provider's Solana tx may pay (plus their token accounts). Observed live. */
export const SVM_FEE_WALLETS: Record<string, string[]> = {
  lifi: ["34FKjAdVcTax2DHqV2XnbXa9J3zmyKcFuFKWbcmgxjgm"], // LI.FI feeCollection step
};

/** Tron contracts per provider (base58). */
export const TVM_CONTRACTS: Record<string, string[]> = {
  lifi: ["TU3ymitEKCWQFtASkEeHaPb8NfZcJtCHLt"], // LiFiDiamond, lifinance/contracts deployments/tron.json
  relay: ["TXtEs6t2oUWQsNos7m68gbHdE9Q5n6x2oN"], // RelayDepository on Tron (observed; not in Relay /chains)
};

export function evmAllowed(provider: string, chainId: number, extra: string[] = []): Set<string> {
  const m: Partial<ChainMap> = EVM_ROUTERS[provider] ?? {};
  return new Set([...(m["*"] ?? []), ...(m[chainId] ?? []), ...extra.map((x) => x.toLowerCase())]);
}
