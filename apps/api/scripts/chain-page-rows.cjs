// Builds the /chains/<slug> page rows from blocktools chainParams() + chainTable(). Shared by the generator and the drift test.
// Examples are well-known PUBLIC addresses (Bitcoin genesis hash re-encoded per chain, published dev/test addresses);
// a row only keeps an example that addressValidate() accepts for that chain.
const GENESIS_P2PKH = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const BTC_P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const ACCOUNT_EXAMPLES = {
  eth: "0xD8dA6BF26964AF9D7EdD9E03e53415D37aA96045",
  tron: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  atom: "cosmos1hsk6jryyqjfhp5dhc55tc9jtckygx0eph6dd02",
  algo: "VCMJKWOY5P5P7SKMZFFOCEROPJCZOTIJMNIYNUCKH7LRO45JMJP6UYBIJA",
  dot: "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5",
  // ksm/polyx: the dot example's public key re-encoded with SS58 prefix 2 / 12.
  ksm: "DnZxLFY3cddikU5Thok5wbWRMskbCrSnh316FEhfQVHwKPb",
  polyx: "2DfAYFfZtXNuHLWiX2byrxFktDJh939eg6aKF5fiHxSAkFqy",
  ada: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
  ton: "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
  xlm: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
  sol: "11111111111111111111111111111111",
  xmr: "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A",
  // Cosmos SDK rows: the atom example's 20-byte account hash re-encoded with each chain's bech32 prefix.
  strd: "stride1hsk6jryyqjfhp5dhc55tc9jtckygx0ep53d3mx",
  axl: "axelar1hsk6jryyqjfhp5dhc55tc9jtckygx0epn5m9yt",
  cre: "cre1hsk6jryyqjfhp5dhc55tc9jtckygx0epnj7g68",
  kuji: "kujira1hsk6jryyqjfhp5dhc55tc9jtckygx0epxj04zq",
  cmdx: "comdex1hsk6jryyqjfhp5dhc55tc9jtckygx0eps400ka",
  ntrn: "neutron1hsk6jryyqjfhp5dhc55tc9jtckygx0epn9y04d",
  somm: "somm1hsk6jryyqjfhp5dhc55tc9jtckygx0epmxzp7q",
  fet: "fetch1hsk6jryyqjfhp5dhc55tc9jtckygx0epy8yfda",
  mars: "mars1hsk6jryyqjfhp5dhc55tc9jtckygx0ep285563",
  umee: "umee1hsk6jryyqjfhp5dhc55tc9jtckygx0ep9vsjtc",
  noble: "noble1hsk6jryyqjfhp5dhc55tc9jtckygx0eplec9hy",
  sei: "sei1hsk6jryyqjfhp5dhc55tc9jtckygx0ep6kumft",
  tia: "celestia1hsk6jryyqjfhp5dhc55tc9jtckygx0epxsua48",
  coreum: "core1hsk6jryyqjfhp5dhc55tc9jtckygx0epy54kg3",
  qsr: "quasar1hsk6jryyqjfhp5dhc55tc9jtckygx0epeehsz0",
  xprt: "persistence1hsk6jryyqjfhp5dhc55tc9jtckygx0epekt7pw",
  akt: "akash1hsk6jryyqjfhp5dhc55tc9jtckygx0ep6pq2ks",
  kava: "kava1hsk6jryyqjfhp5dhc55tc9jtckygx0ept0esed",
  blz: "bluzelle1hsk6jryyqjfhp5dhc55tc9jtckygx0epzzw0fm",
  band: "band1hsk6jryyqjfhp5dhc55tc9jtckygx0epw4d0hz",
  cro: "cro1hsk6jryyqjfhp5dhc55tc9jtckygx0ep0p95nm",
  bld: "agoric1hsk6jryyqjfhp5dhc55tc9jtckygx0ep980jlu",
  dydx: "dydx1hsk6jryyqjfhp5dhc55tc9jtckygx0ep7rrf0a",
  rune: "thor1hsk6jryyqjfhp5dhc55tc9jtckygx0ep3a5k64",
  // Ethermint rows (inj/evmos/canto/zeta): the eth example's 20 bytes re-encoded with the chain prefix.
  inj: "inj1mrdxhunfvjhe6lkancp72dq46da2jcz9lmv4wx",
  evmos: "evmos1mrdxhunfvjhe6lkancp72dq46da2jcz9hn2lxk",
  canto: "canto1mrdxhunfvjhe6lkancp72dq46da2jcz98y6pgk",
  zeta: "zeta1mrdxhunfvjhe6lkancp72dq46da2jcz9rk4yxw",
  // ed25519 rows: Trust Wallet Core CoinAddressDerivationTests addresses for its public dummy key (0x46 x 32).
  aptos: "0xce2fd04ac9efa74f17595e5785e847a2399d7e637f5e8179244f76191f653276",
  sui: "0x870deb25d5c0a4d7250d52d5cd58dacca2d51eb2a120a979b13384cd52e21e1b",
  near: "ee93a4f66f8d16b819bb9beb9ffccdfcdc1412e87fee6a324c2a99a1e0e67148",
  xtz: "tz1gcEWswVU6dxfNQWbhTgaZrUrNUFwrsT4z",
  egld: "erd1a6f6fan035ttsxdmn04ellxdlnwpgyhg0lhx5vjv92v6rc8xw9yq83344f",
};
const slugOf = (title) =>
  title
    .replace(/\(.*?\)/g, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
function tryV(w, chain, a) {
  try {
    return a ? w.addressValidate(chain, a) : null;
  } catch {
    return null;
  }
}
function conv(w, a, to) {
  try {
    return w.convertAddressFrom("btc", a, to);
  } catch {
    return null;
  }
}
function chainPageRows(w) {
  const params = JSON.parse(w.chainParams());
  const table = new Map(JSON.parse(w.chainTable()).map((r) => [r.name, r]));
  return params.map((p) => {
    const t = table.get(p.name);
    const utxo = (p.p2pkh?.length ?? 0) > 0;
    const examples = [];
    const add = (a) => {
      const kind = tryV(w, p.name, a);
      if (kind) examples.push({ address: a, kind });
    };
    if (utxo) {
      add(p.name === "btc" ? GENESIS_P2PKH : conv(w, GENESIS_P2PKH, p.name));
      add(p.name === "btc" ? BTC_P2SH : conv(w, BTC_P2SH, p.name));
    } else add(ACCOUNT_EXAMPLES[p.name]);
    return {
      name: p.name,
      slug: slugOf(p.title),
      ticker: p.ticker,
      title: p.title,
      slip44: p.slip44 ?? null,
      curve: t ? t.curve : "secp256k1",
      family: utxo ? "utxo" : p.name,
      decimals: p.decimals,
      p2pkh: p.p2pkh,
      p2sh: p.p2sh,
      hrp: p.hrp,
      wif: p.wif,
      checksum: p.checksum,
      forkid: p.forkid,
      tx_format: p.tx_format,
      verified: p.verified,
      scope: p.scope ?? null,
      explorers: (p.sources ?? []).map((s) => ({ name: s.name, url: s.url })),
      examples,
    };
  });
}
module.exports = { chainPageRows };
