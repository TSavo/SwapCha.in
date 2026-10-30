import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fx from "./fixtures/sol-mainnet-txs.json";
import * as sv from "./guard/svm.js";
import * as oc from "./onchain.js";
import * as C from "./sol.corpus.js";
import * as sr from "./solrecover.js";
import { decodeSolana } from "./txtools.js";

/**
 * Solana address math and tx decode moved to blocktools wasm (66dc76c). The digests below are the outputs of the
 * deleted TypeScript (onchain.ts bigint ed25519 + base58, guard/svm.ts and solrecover.ts noble copies) on the
 * same deterministic corpus, recorded before deletion; the three PDA copies agreed with each other.
 */
const dig = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const real = [...new Set(fx.txs.flatMap((t) => [t.feePayer, ...t.programs, ...t.signers]))].sort();
const progs = real.slice(0, 40);
const owners = real.slice(0, 60);

describe("Solana address math: blocktools == deleted TS", () => {
  it("corpus size", () => expect(real.length).toBe(164));
  it("on-curve (3005 keys + 164 mainnet accounts)", () => {
    expect(dig(C.curveKeys().map((k) => oc.onCurve(k)))).toBe(
      "0d1660195ba7d405be4f4da01ddac04069527944fadf37d8299dcff7cda54749",
    );
    expect(dig(real.map((a) => oc.onCurve(oc.b58decode(a))))).toBe(
      "cc630f07313c7b2a91d761ecb5151ecc22610d7bb700ac3f13f70e5f71714cd7",
    );
  });
  it("non-canonical / x=0-sign encodings follow curve25519-dalek (Solana runtime); old TS said off-curve", () => {
    for (const k of C.DALEK_ONLY) expect(oc.onCurve(k)).toBe(true);
  });
  it("base58 encode/decode (2000 strings, leading zeros)", () => {
    expect(dig(C.byteStrings().map((b) => oc.b58encode(b)))).toBe(
      "0234c66a799868c02669537221a194d3eaeec6d2e49eedb45b9f2d17f4111958",
    );
    expect(
      dig(C.byteStrings().map((b) => Buffer.from(oc.b58decode(oc.b58encode(b))).toString("hex"))),
    ).toBe("1af8acba471371da95ab18982f844493f80ba00b4ba3511a1d5a4db15fcc012b");
    for (const bad of ["0", "O", "I", "l", "abc0", " 1", "+/"])
      expect(() => oc.b58decode(bad)).toThrow(/invalid base58/);
    expect(oc.b58decode("").length).toBe(0);
  }, 60_000);
  it("PDA x400 (onchain, guard/svm, solrecover)", () => {
    const want = "917b062743898e4cc483ea446a2c5131e284d54e795dbb84369afffd6e4eb034";
    expect(dig(C.pdaCases(progs).map((c) => oc.findPda(c.seeds, c.program)))).toBe(want);
    expect(dig(C.pdaCases(progs).map((c) => sv.pda(c.seeds, c.program)))).toBe(want);
    expect(dig(C.pdaCases(progs).map((c) => sr.findPda(c.seeds, c.program)))).toBe(want);
  });
  it("ATA x360 (SPL + Token-2022)", () =>
    expect(
      dig(owners.flatMap((o) => C.MINTS.flatMap((m) => [sv.ata(o, m), sv.ata(o, m, sv.TOKEN22)]))),
    ).toBe("8b4f9b710a2f0ce6db69f11755be2043ebfd4bf9f5a00ab43bce49766e594ef2"));
  it("anchor discriminators", () =>
    expect(dig(C.ANCHOR_NAMES.map(sr.anchorDisc))).toBe(
      "c5bfa739746cf7437afd1822562019fe89a6a0236562ae4721a8211f103b9903",
    ));
  it("known vectors", () => {
    expect(oc.snsKey("bonfida")).toBe("Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb");
    expect(sr.anchorDisc("claim")).toBe(
      createHash("sha256").update("global:claim").digest("hex").slice(0, 16),
    );
  });
});

describe("decodeSolana (txtools) on 150 mainnet txs vs RPC json ground truth", () => {
  const ok = fx.txs.filter((t) => t.version !== 1);
  it("legacy + v0: fee payer, signers, programs match the RPC", () => {
    expect(ok.length).toBe(140);
    for (const t of ok) {
      const d = decodeSolana(t.tx);
      expect([d.feePayer, d.signers, d.programs, d.versioned, d.signed]).toEqual([
        t.feePayer,
        t.signers,
        t.programs,
        t.version !== "legacy",
        true,
      ]);
    }
  });
  it("v1 txs (blocktools af2723f decoder): fee payer, signers, programs match the RPC", () => {
    const v1 = fx.txs.filter((t) => t.version === 1);
    expect(v1.length).toBe(10);
    for (const t of v1) {
      const d = decodeSolana(t.tx);
      expect([d.feePayer, d.signers, d.programs, d.versioned, d.signed]).toEqual([
        t.feePayer,
        t.signers,
        t.programs,
        true,
        true,
      ]);
    }
  });
  it("truncated / garbage refused", () => {
    const t = Buffer.from(ok[0]!.tx, "base64");
    expect(() => decodeSolana(t.subarray(0, t.length - 5).toString("base64"))).toThrow(
      /cannot decode/,
    );
    expect(() => decodeSolana(Buffer.concat([t, Buffer.of(0)]).toString("base64"))).toThrow(
      /cannot decode/,
    );
    expect(() => decodeSolana("")).toThrow(/cannot decode/);
  });
});

describe("guard parseSvmBase64 (blocktools decode) == decodeSolana, exposes keys + data", () => {
  // The old hand-rolled wire reader only handled legacy + v0 (version !== 1); blocktools decodes all three.
  it("legacy + v0: fee payer, signers and the instruction program list agree with decodeSolana", () => {
    const ok = fx.txs.filter((t) => t.version !== 1);
    expect(ok.length).toBe(140);
    for (const t of ok) {
      const p = sv.parseSvmBase64(t.tx);
      const d = decodeSolana(t.tx);
      expect(p.feePayer).toBe(d.feePayer);
      expect(p.signers).toEqual(d.signers);
      // decodeSolana dedupes program ids; parseSvmBase64 keeps one per instruction
      expect([...new Set(p.ixs.map((i) => i.programId))]).toEqual(d.programs);
      // every instruction carries the raw keys array (undefined for lookup-table accounts) and data bytes
      for (const ix of p.ixs) {
        expect(ix.data).toBeInstanceOf(Uint8Array);
        expect(Array.isArray(ix.keys)).toBe(true);
      }
    }
  });
  it("matches the RPC ground truth (same corpus decodeSolana is checked against)", () => {
    for (const t of fx.txs.filter((t) => t.version !== 1)) {
      const p = sv.parseSvmBase64(t.tx);
      expect(p.feePayer).toBe(t.feePayer);
      expect(p.signers).toEqual(t.signers);
      expect([...new Set(p.ixs.map((i) => i.programId))]).toEqual(t.programs);
    }
  });
  it("address-lookup-table accounts stay undefined (fail-closed destination), like the old parser", () => {
    const withLookups = fx.txs
      .filter((t) => t.version !== 1)
      .map((t) => sv.parseSvmBase64(t.tx))
      .find((p) => p.ixs.some((ix) => ix.keys.some((k) => k === undefined)));
    expect(withLookups).toBeDefined();
  });
  it("truncated / garbage refused (fail closed)", () => {
    const t = Buffer.from(fx.txs[0]!.tx, "base64");
    expect(() => sv.parseSvmBase64(t.subarray(0, t.length - 5).toString("base64"))).toThrow();
    expect(() => sv.parseSvmBase64("")).toThrow();
  });
});
