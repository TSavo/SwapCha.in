import { describe, expect, it } from "vitest";
import { anchorDisc, checkSolSpec, marinadeClaimIx, marinadeReserve } from "./solrecover.js";

const me = "x9MnankcYsGWsv4pvG159zpVZ7dBC2fimrFJ3ZdvCqY";
describe("solrecover", () => {
  it("derives Marinade reserve PDA and claim discriminator", () => {
    expect(marinadeReserve()).toBe("Du3Ysj1wKbxPKkuPPnvzQLQh8oMSVifs3jGZjJWXFmHN");
    expect(anchorDisc("claim")).toBe("3ec6d6c1d59f6cd2");
  });
  it("allows owner-only claims, rejects other recipients/signers/programs", () => {
    const ix = marinadeClaimIx("1Qcce1i7ZcGRzXWKEXsFtDnuZPviQBgZd3FCDbnmyMw", me);
    expect(checkSolSpec({ owner: me, ix: [ix] }, me)).toBeNull();
    const other = "11111111111111111111111111111112";
    expect(checkSolSpec({ owner: me, ix: [marinadeClaimIx("1Qcce1i7ZcGRzXWKEXsFtDnuZPviQBgZd3FCDbnmyMw", other)] }, me)).toMatch(/owner/);
    expect(checkSolSpec({ owner: me, ix: [{ ...ix, keys: [...ix.keys, { pubkey: other, isSigner: true, isWritable: false }] }] }, me)).toMatch(/signer/);
    expect(checkSolSpec({ owner: me, ix: [{ ...ix, programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }] }, me)).toMatch(/allowlisted/);
  });
});
