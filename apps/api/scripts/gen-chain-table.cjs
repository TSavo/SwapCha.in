// Regenerates packages/shared/src/chainTable.json from the vendored blocktools wasm: chainTable() rows plus zec,
// which chainTable omits and listChains() appends (its row comes from chainParams()). Display metadata only.
// Run: node apps/api/scripts/gen-chain-table.cjs   (blocktools.chaintable.test.ts fails when the file is stale)
const fs = require("node:fs");
const path = require("node:path");
const w = require("../vendor/blocktools/blocktools_wasm.js");
const { chainTableRows } = require("./chain-table-rows.cjs");
const out = path.join(__dirname, "../../../packages/shared/src/chainTable.json");
fs.writeFileSync(out, `${JSON.stringify(chainTableRows(w), null, 2)}\n`);
console.log(`wrote ${out}`);
