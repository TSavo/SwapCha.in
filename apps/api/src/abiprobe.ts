/**
 * ABI discovery for unknown contracts found in wallet history: Blockscout verified ABIs, then bytecode
 * selectors resolved through the public signature databases (openchain, 4byte). Names from signature
 * databases are guesses (collisions exist), so callers must treat them as leads and simulate first.
 */
type F = typeof fetch;
const BLOCKSCOUT: Record<number, string> = {
  1: "https://eth.blockscout.com", 10: "https://optimism.blockscout.com", 8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com", 137: "https://polygon.blockscout.com", 534352: "https://scroll.blockscout.com",
  100: "https://gnosis.blockscout.com", 42220: "https://celo.blockscout.com", 324: "https://zksync.blockscout.com",
};
export async function blockscoutAbi(f: F, chainId: number, addr: string): Promise<unknown[] | undefined> {
  const h = BLOCKSCOUT[chainId];
  if (!h) return undefined;
  try {
    const r = await f(`${h}/api/v2/smart-contracts/${addr}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { abi?: unknown[]; is_verified?: boolean };
    return Array.isArray(j.abi) && j.abi.length ? j.abi : undefined;
  } catch { return undefined; }
}

/** Pure: 4-byte selectors pushed by PUSH4 in runtime bytecode (dispatcher table), deduped. */
export function bytecodeSelectors(code: string): string[] {
  const b = code.replace(/^0x/, "");
  const out = new Set<string>();
  for (let i = 0; i + 10 <= b.length; i += 2) {
    const op = parseInt(b.slice(i, i + 2), 16);
    if (op === 0x63) { out.add("0x" + b.slice(i + 2, i + 10)); i += 8; }
    else if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2; // skip other PUSH data
  }
  out.delete("0xffffffff"); out.delete("0x00000000");
  return [...out].slice(0, 200);
}

export async function resolveSelectors(f: F, sels: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!sels.length) return out;
  try {
    const r = await f(`https://api.openchain.xyz/signature-database/v1/lookup?filter=true&function=${sels.slice(0, 120).join(",")}`, { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { result?: { function?: Record<string, { name: string }[] | null> } };
    for (const [s, v] of Object.entries(j.result?.function ?? {})) if (v?.length) out[s] = v.map((x) => x.name);
  } catch {}
  const missing = sels.filter((s) => !out[s]).slice(0, 4);
  await Promise.all(missing.map(async (s) => {
    try {
      const r = await f(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${s}`, { signal: AbortSignal.timeout(4000) });
      const j = (await r.json()) as { results?: { text_signature: string }[] };
      if (j.results?.length) out[s] = j.results.map((x) => x.text_signature);
    } catch {}
  }));
  return out;
}

const RECOVERY = /^(withdraw|withdrawAll|claim|claimAll|claimReward|claimRewards|exit|unstake|unstakeAll|redeem|getReward|harvest|release|refund|emergencyWithdraw|withdrawDividends|reinvest)\((address)?\)$/;
/** Pure: recovery-looking zero-arg or (address) signatures among resolved names / a verified ABI. */
export function recoveryCandidates(names: string[], abi?: unknown[]): string[] {
  const fromAbi = (abi ?? []).flatMap((x) => {
    const e = x as { type?: string; name?: string; inputs?: { type: string }[]; stateMutability?: string };
    if (e.type !== "function" || !e.name || e.stateMutability === "view" || e.stateMutability === "pure") return [];
    return [`${e.name}(${(e.inputs ?? []).map((i) => i.type).join(",")})`];
  });
  return [...new Set([...fromAbi, ...names])].filter((s) => RECOVERY.test(s)).slice(0, 12);
}
