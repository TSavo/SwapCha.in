import { btDecode, btSolDecodeTx } from "../blocktools.js";

/**
 * Independent second decode of non-EVM payloads with the blocktools wasm. The guard's own parse
 * (bitcoinjs / the Solana wire parser) and blocktools must agree on what the tx does; any
 * disagreement, decode error or missing wasm is a failure (fail closed).
 */
export function crossCheckPsbt(
  psbt: string,
  outs: { address: string | null; value: bigint }[],
  taker: string,
): string[] {
  let d: ReturnType<typeof btDecode>;
  try {
    d = btDecode(psbt, "btc");
  } catch (e) {
    return [`blocktools cannot decode the PSBT: ${(e as Error).message}`];
  }
  if (!d) return ["blocktools decoder unavailable"];
  const bad: string[] = [];
  const sum = d.find((x) => x.role === "summary") as Record<string, unknown> | undefined;
  if (!sum || sum.type !== "psbt") bad.push("blocktools: not a PSBT");
  if (sum?.signed !== false) bad.push("blocktools: PSBT is already signed");
  const ins = d.filter((x) => x.role === "input");
  if (!ins.length) bad.push("blocktools: no inputs");
  for (const i of ins)
    if (i.address !== taker) bad.push(`input spends ${i.address ?? "unknown"}, not the taker`);
  const bo = d.filter((x) => x.role === "output");
  if (bo.length !== outs.length) bad.push("blocktools: output count differs");
  else
    outs.forEach((o, k) => {
      const b = bo[k]!;
      if (BigInt(b.amount ?? "-1") !== o.value || (o.address !== null && b.address !== o.address))
        bad.push(`blocktools: output ${k} differs`);
    });
  return bad;
}

export function crossCheckSvm(b64: string, feePayer: string, programs: string[]): string[] {
  let t: ReturnType<typeof btSolDecodeTx>;
  try {
    t = btSolDecodeTx(b64);
  } catch (e) {
    return [`blocktools cannot decode the Solana tx: ${(e as Error).message}`];
  }
  const bad: string[] = [];
  if (t.fee_payer !== feePayer) bad.push(`blocktools: fee payer ${t.fee_payer} differs`);
  const got = t.instructions.map((i) => i.program);
  if (got.length !== programs.length || got.some((p, k) => p !== programs[k]))
    bad.push("blocktools: instruction programs differ");
  if (t.signatures.some((s) => s.status === "invalid")) bad.push("blocktools: invalid signature");
  return bad;
}
