import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as C from "./addr.corpus.js";
import { blocktools } from "./blocktools.js";
import { vmOfAddr } from "./intel.js";
import { isXrpAddress } from "./ledgers.js";
import { cashToLegacy } from "./utxochains.js";

// Goldens recorded from the deleted TS implementations (CashAddr polymod decoder, XRP base58check,
// Solana base58 32-byte check) over the same corpora, before switching to blocktools.
const dig = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

describe("address fallbacks: blocktools matches the old TS", () => {
  it("CashAddr -> legacy", () => {
    const w = blocktools()!;
    const cc = C.cashCorpus((k, x) => w.cashAddrEncode("bitcoincash", k, x));
    expect(cc.length).toBe(2705);
    const out = cc.map(cashToLegacy);
    expect(out.filter(Boolean).length).toBe(1502);
    expect(dig(out)).toBe("d1fef5fc677a2dccfa533c86cf3ecfabce94fd6f11d8e687b606eef5cd09647e");
    expect(cashToLegacy("bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a")).toBe(
      "1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu",
    );
  });
  it("XRP classic r-address (X-addresses rejected, as before)", () => {
    const xc = C.xrpCorpus();
    expect(xc.length).toBe(1509);
    const out = xc.map(isXrpAddress);
    expect(out.filter(Boolean).length).toBe(536);
    expect(dig(out)).toBe("ab71f8d0a5a08adacb6a12ee4958501fe99cacb1e03c4a036aa5901dfdbcae17");
    expect(isXrpAddress("XVLhHMPHU98es4dbozjVtdWzVrDjtV5fdx1mHp98tDMoQXb")).toBe(false);
  });
  it("Solana key check in vmOfAddr", () => {
    const sc = C.svmCorpus();
    expect(sc.length).toBe(803);
    const out = sc.map(vmOfAddr);
    expect(out.filter((v) => v === "svm").length).toBe(551);
    expect(dig(out)).toBe("b7cabba4210c2707b580519453d8cada47d75c7ff6b25dd9b11c903f3d70b903");
  });
});
