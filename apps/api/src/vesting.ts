/**
 * Vesting: Sablier Lockup + Flow streams where this wallet is the recipient (Sablier's public Envio indexer,
 * every chain). Withdrawable amount is read on-chain (withdrawableAmountOf), the tx is withdrawMax(id, owner),
 * simulated from the owner before it is offered. Chains SwapChan has no RPC for become leads.
 */
import { formatUnits, getAddress, parseAbi } from "viem";
import { encodeFunctionData } from "./blocktools.js";
import type { Found } from "./intel.js";
import { chainName, evmClient, json, prices, pxOf, swapUrl, usdcOf } from "./onchain.js";

type F = typeof fetch;
const IDX = "https://indexer.hyperindex.xyz/53b7e25/v1/graphql";
const ABI = parseAbi([
  "function withdrawableAmountOf(uint256 streamId) view returns (uint128)",
  "function withdrawMax(uint256 streamId, address to) payable returns (uint128)",
]);
type S = {
  id: string;
  chainId: string;
  contract: string;
  tokenId: string;
  asset: { address: string; symbol: string; decimals: string };
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function sablierStreams(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
): Promise<Found[]> {
  const me = owner.toLowerCase();
  const q = `{ L: LockupStream(limit: 50, where: { recipient: { _eq: "${me}" }, depleted: { _eq: false } }) { id chainId contract tokenId asset { address symbol decimals } }
               F: FlowStream(limit: 50, where: { recipient: { _eq: "${me}" }, voided: { _eq: false } }) { id chainId contract tokenId asset { address symbol decimals } } }`;
  const r = await json<{ data?: { L?: S[]; F?: S[] }; errors?: { message: string }[] }>(
    f,
    IDX,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q }),
    },
    10_000,
  );
  if (r.errors?.length) throw new Error(`Sablier indexer: ${r.errors[0]!.message.slice(0, 60)}`);
  const all = [
    ...(r.data?.L ?? []).map((s) => ({ ...s, kind: "Lockup" })),
    ...(r.data?.F ?? []).map((s) => ({ ...s, kind: "Flow" })),
  ];
  if (!all.length) return [];
  const rows = await Promise.all(
    all.map(async (s) => {
      const chainId = Number(s.chainId),
        to = getAddress(s.contract),
        id = BigInt(s.tokenId);
      let c;
      try {
        c = evmClient(chainId, env);
      } catch {
        return { s, chainId, to, id, amt: null as bigint | null, sim: false, noRpc: true };
      }
      const amt = await c
        .readContract({ address: to, abi: ABI, functionName: "withdrawableAmountOf", args: [id] })
        .catch(() => null);
      let sim = false;
      if (amt && amt > 0n)
        sim = await c
          .simulateContract({
            address: to,
            abi: ABI,
            functionName: "withdrawMax",
            args: [id, getAddress(owner)],
            account: getAddress(owner),
            value: 0n,
          })
          .then(
            () => true,
            () => false,
          );
      return { s, chainId, to, id, amt, sim, noRpc: false };
    }),
  );
  const px = await prices(
    f,
    rows.map((x) => ({ chainId: x.chainId, address: getAddress(x.s.asset.address) })),
  ).catch(() => new Map());
  return rows.flatMap((x) => {
    const dec = Number(x.s.asset.decimals),
      sym = x.s.asset.symbol;
    if (x.noRpc)
      return [
        {
          kind: "lead" as const,
          protocol: `Sablier ${x.s.kind}`,
          chainId: x.chainId,
          what: `stream #${x.id} (${sym}) on chain ${x.chainId}: SwapChan has no RPC there, withdrawable amount not read`,
          valueUsd: null,
          action: "Not checked on this chain",
        } as Found,
      ];
    if (!x.amt || x.amt === 0n) return [];
    const n = Number(formatUnits(x.amt, dec));
    const p = pxOf(px, x.chainId, getAddress(x.s.asset.address))?.price ?? null;
    const data = encodeFunctionData({
      abi: ABI,
      functionName: "withdrawMax",
      args: [x.id, getAddress(owner)],
    });
    return [
      {
        kind: "claimable" as const,
        protocol: `Sablier ${x.s.kind} stream`,
        chainId: x.chainId,
        what: `#${x.id}: ${n.toPrecision(6)} ${sym} withdrawable now on ${chainName(x.chainId)}`,
        valueUsd: p ? r2(n * p) : null,
        ...(x.sim
          ? {
              claimTx: {
                chainId: x.chainId,
                to: x.to,
                data,
                value: "0",
                description: `Sablier withdrawMax(#${x.id}) → your wallet`,
              },
            }
          : {}),
        action: x.sim
          ? `Sign withdrawMax, then swap ${sym} on SwapChan`
          : "Withdraw simulation reverted (stream may need a fee or be paused); no tx offered",
        link: swapUrl(
          x.chainId,
          getAddress(x.s.asset.address),
          x.chainId,
          usdcOf(x.chainId) ?? getAddress(x.s.asset.address),
          String(n),
        ),
        underlying: getAddress(x.s.asset.address),
        evidence: [
          {
            chainId: x.chainId,
            address: x.to,
            call: "withdrawableAmountOf(uint256)",
            args: [String(x.id)],
            raw: String(x.amt),
          },
        ],
      } as Found,
    ];
  });
}
