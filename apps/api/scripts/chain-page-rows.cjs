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
