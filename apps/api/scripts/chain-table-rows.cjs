// Shared by gen-chain-table.cjs and the drift test: chainTable() display fields + zec (as listChains() adds it).
const KEYS = [
  "name",
  "ticker",
  "title",
  "coin_type",
  "curve",
  "encoding",
  "native_seed",
  "sign",
  "buildable",
  "verified",
  "source",
];
const pick = (r) => Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
function chainTableRows(w) {
  const rows = JSON.parse(w.chainTable()).map(pick);
  const names = JSON.parse(w.listChains());
  const params = JSON.parse(w.chainParams());
  for (const n of names.filter((n) => !rows.some((r) => r.name === n))) {
    const p = params.find((x) => x.name === n);
    if (!p) throw new Error(`listChains has ${n} but chainParams does not`);
    // not in chainTable: fields from chainParams; curve/encoding follow its Base58 (UTXO) family
    rows.push(
      pick({
        name: p.name,
        ticker: p.ticker,
        title: p.title,
        coin_type: p.slip44,
        curve: "secp256k1",
        encoding: "utxo",
        native_seed: false,
        sign: p.tx_format,
        buildable: p.sweep_build,
        verified: p.verified,
        source: "chainParams row (not in chainTable; listChains adds it)",
      }),
    );
  }
  return rows;
}
module.exports = { chainTableRows };
