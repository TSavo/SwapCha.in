/**
 * Allowance-based approvals check for chains with no free Approval-log source.
 * For each token the wallet holds, reads allowance(owner, spender) over a curated list of
 * well-known spenders (DEX routers/aggregators, Permit2, bridges, lending pools, NFT conduits).
 * Coverage is "known spenders only": unusual spenders are NOT covered.
 */
import { getAddress, erc20Abi, type PublicClient } from "viem";

const ALL: Record<string, string> = {
  "0x000000000022D473030F116dDEE9F6B43aC78BA3": "Uniswap Permit2",
  "0x1111111254EEB25477B68fb85Ed929f73A960582": "1inch v5 Router",
  "0x111111125421cA6dc452d289314280a0f8842A65": "1inch v6 Router",
  "0xDef1C0ded9bec7F1a1670819833240f027b25EfF": "0x Exchange Proxy",
  "0x0000000000001fF3684f28c67538d4D072C22734": "0x AllowanceHolder",
  "0x216B4B4Ba9F3e719726886d34a177484278Bfcae": "ParaSwap v5 TokenTransferProxy",
  "0x6A000F20005980200259B80c5102003040001068": "ParaSwap Augustus v6",
  "0x6352a56caadC4F1E25CD6c75970Fa768A3304e64": "OpenOcean Exchange",
  "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5": "KyberSwap MetaAggregationRouterV2",
  "0x1E0049783F008A0085193E00003D00cd54003c71": "OpenSea Seaport conduit",
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD": "Uniswap Universal Router (2023)",
  "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4": "PancakeSwap Smart Router",
  "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506": "SushiSwap V2 Router",
};
export const KNOWN_SPENDERS: Record<number, Record<string, string>> = {
  8453: {
    ...ALL,
    "0x6fF5693b99212Da76ad316178A184AB56D299b43": "Uniswap Universal Router (v4)",
    "0x2626664c2603336E57B271c5C0b26F421741e481": "Uniswap SwapRouter02",
    "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43": "Aerodrome Router",
    "0x6Cb442acF35158D5eDa88fe602221b67B400Be3E": "Aerodrome Universal Router",
    "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5": "Aave v3 Pool",
    "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64": "Across SpokePool",
  },
  56: {
    ...ALL,
    "0x10ED43C718714eb63d5aA57B78B54704E256024E": "PancakeSwap V2 Router",
    "0x1A0A18AC4BECDDbd6389559687d1A73d8927E416": "PancakeSwap Universal Router",
    "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2": "Uniswap SwapRouter02",
    "0x6807dc923806fE8Fd134338EABCA509979a7e0cB": "Aave v3 Pool",
    "0x4e8E101924eDE233C13e2D8622DC8aED2872d505": "Across SpokePool",
  },
};
export const spendersFor = (chainId: number) => KNOWN_SPENDERS[chainId] ?? ALL;
export const KNOWN_ONLY_NOTE = "checked known spenders only (major routers, Permit2, bridges, lending, NFT conduits); unusual spenders are not covered";

export async function knownSpenderAllowances(c: Pick<PublicClient, "multicall">, chainId: number, owner: string, tokens: string[]) {
  const sp = Object.entries(spendersFor(chainId));
  const pairs = tokens.slice(0, 40).flatMap((t) => sp.map(([s, name]) => ({ token: getAddress(t), spender: getAddress(s), name })));
  const out: { token: string; spender: string; name: string; allowance: bigint }[] = [];
  for (let i = 0; i < pairs.length; i += 400) {
    const chunk = pairs.slice(i, i + 400);
    const res = await c.multicall({
      allowFailure: true,
      contracts: chunk.map((p) => ({ address: p.token, abi: erc20Abi, functionName: "allowance", args: [getAddress(owner), p.spender] })) as never[],
    });
    res.forEach((r, j) => {
      if (r.status === "success" && (r.result as unknown as bigint) > 0n) out.push({ ...chunk[j]!, allowance: r.result as unknown as bigint });
    });
  }
  return out;
}
