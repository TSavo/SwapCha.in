import { describe, expect, it } from "vitest";
import { blocktools } from "./blocktools.js";
import { BT_PARAMS, COINS, type Coin } from "./utxochains.js";

/**
 * blocktools 54ae67a exports its chain registry as data (wasm chainTable). SwapChan takes version bytes, hrp and
 * decimals from chainParams (BT_PARAMS); this checks the two exports agree for every SwapChan coin, so a registry
 * change in blocktools that only reaches one of them fails here instead of in an address or sweep.
 */
type Row = {
  name: string;
  coin_type: number;
  p2pkh: number | null;
  p2sh: number | null;
  wif: number | null;
  hrp: string | null;
  verified: boolean;
};
const w = blocktools() as unknown as { chainTable?: () => string } | null;
const TABLE = new Map(
  (w?.chainTable ? (JSON.parse(w.chainTable()) as Row[]) : []).map((r) => [r.name, r]),
);
/** Not in blocktools CHAINS (listChains adds it separately); 54ae67a lists it as untested. */
const NOT_IN_TABLE = new Set<Coin>(["zec"]);

describe("blocktools chainTable vs chainParams (SwapChan coins)", () => {
  it("is exported by the vendored wasm", () => {
    expect(typeof w?.chainTable).toBe("function");
    expect(TABLE.size).toBeGreaterThanOrEqual(40);
  });
  for (const k of Object.keys(COINS) as Coin[]) {
    it(k, () => {
      const t = TABLE.get(k);
      if (NOT_IN_TABLE.has(k)) {
        expect(t).toBeUndefined();
        return;
      }
      const p = BT_PARAMS?.get(k) as
        | (Record<string, unknown> & { p2pkh: number[]; p2sh: number[]; hrp: string | null })
        | undefined;
      expect(t, `${k} in chainTable`).toBeDefined();
      expect(p, `${k} in chainParams`).toBeDefined();
      expect([t!.p2pkh]).toEqual(p!.p2pkh);
      expect([t!.p2sh]).toEqual(p!.p2sh);
      expect(t!.hrp).toBe(p!.hrp);
      expect(t!.wif).toBe(p!.wif);
      expect(t!.coin_type).toBe(p!.slip44);
      expect(t!.verified).toBe(p!.verified);
      expect(COINS[k].p2pkh).toEqual(p!.p2pkh);
    });
  }
});
