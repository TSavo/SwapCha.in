import { describe, expect, it, vi } from "vitest";

vi.mock("./blocktools.js", async (orig) => {
  const m = await orig<typeof import("./blocktools.js")>();
  const need = () => {
    throw new Error("blocktools unavailable");
  };
  return {
    ...m,
    blocktools: () => null,
    btB58Encode: need,
    btB58Decode: need,
    btSolOnCurve: need,
    btSolPda: need,
    btSolAta: need,
    btSolAnchorDisc: need,
    btSolDecodeTx: need,
  };
});

describe("Solana helpers fail closed without blocktools (no TS fallback)", () => {
  it("onchain / guard / solrecover / txtools all throw", async () => {
    const oc = await import("./onchain.js");
    const sv = await import("./guard/svm.js");
    const sr = await import("./solrecover.js");
    const tt = await import("./txtools.js");
    expect(() => oc.b58decode("11")).toThrow(/blocktools unavailable/);
    expect(() => oc.b58encode(new Uint8Array(1))).toThrow(/blocktools unavailable/);
    expect(() => oc.onCurve(new Uint8Array(32))).toThrow(/blocktools unavailable/);
    expect(() => oc.snsKey("bonfida")).toThrow(/blocktools unavailable/);
    expect(() => sv.ata(sv.SYSTEM, sv.WSOL)).toThrow(/blocktools unavailable/);
    expect(() => sv.parseSvmBase64("AA==")).toThrow(/blocktools unavailable/);
    expect(() => sr.marinadeReserve()).toThrow(/blocktools unavailable/);
    expect(() => sr.anchorDisc("claim")).toThrow(/blocktools unavailable/);
    expect(() => tt.decodeSolana("AA==")).toThrow(/blocktools unavailable/);
  }, 60_000);
});
