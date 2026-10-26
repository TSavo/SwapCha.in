/**
 * Pinned Relay depository per chain. GET /chains is never trusted on its own: if it reports a
 * different depository for a pinned chain, the Relay deposit is refused (see relay.ts).
 *
 * Each pin was present in BOTH sources on 2026-10-26 and they agreed:
 *  1. api.relay.link/chains protocol.v2.depository
 *  2. github.com/relayprotocol/relay-settlement packages/networks/src/networks/*.ts
 *     (contracts.prod.depository), commit b2f3e0e5fba9381293f030ef340ffb4872687fcf
 * Chains where the sources disagreed or only one listed the chain are deliberately unpinned:
 * xlayer 196, lisk 1135, hyperliquid 1337, xrp 537724, lighter 3586256, robinhood-lighter
 * 548123634, bitcoin 8253038 (sources differ), ton 224235520. Those still use /chains as before.
 * EVM addresses lowercase; others exact.
 */
export const RELAY_DEPOSITORY_PINS: Readonly<Record<number, string>> = {
  1: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // ethereum
  10: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // optimism
  25: "0x59916da825d2d2ec1bf878d71c88826f6633ecca", // cronos
  56: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // bsc
  100: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // gnosis
  130: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // unichain
  137: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // polygon
  143: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // monad
  146: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // sonic
  169: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // manta-pacific
  288: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // boba
  324: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // zksync
  360: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // shape
  480: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // world-chain
  747: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // flow-evm
  988: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // stable
  999: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // hyperevm
  1088: "0x59916da825d2d2ec1bf878d71c88826f6633ecca", // metis
  1868: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // soneium
  2020: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // ronin
  2741: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // abstract
  2818: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // morph
  4217: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // tempo
  4326: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // megaeth
  4663: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // robinhood
  5000: "0x59916da825d2d2ec1bf878d71c88826f6633ecca", // mantle
  5031: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // somnia
  5042: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // arc
  8453: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // base
  9745: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // plasma
  33139: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // apechain
  34443: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // mode
  42018: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // mythos
  42161: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // arbitrum
  42220: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // celo
  43114: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // avalanche
  48900: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // zircuit
  57073: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // ink
  59144: "0x59916da825d2d2ec1bf878d71c88826f6633ecca", // linea
  60808: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // bob
  80094: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // berachain
  97477: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // doma
  98866: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // plume
  534352: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // scroll
  685689: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // gensyn
  747474: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // katana
  5064014: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // ethereal
  7777777: "0x4cd00e387622c35bddb9b4c962c136462338bc31", // zora
  9286185: "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2", // eclipse
  728126428: "TXtEs6t2oUWQsNos7m68gbHdE9Q5n6x2oN", // tron
  792703809: "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2", // solana
};
