import { type AbiParameter, decodeFunctionData, parseAbi } from "viem";

const ty = (x: AbiParameter): string =>
  x.type.startsWith("tuple") && "components" in x
    ? `(${x.components.map(ty).join(", ")})${x.type.slice(5)}`
    : `${x.type}${x.name ? ` ${x.name}` : ""}`;
const par = (x: AbiParameter) =>
  x.type.startsWith("tuple") && x.name ? `${ty(x)} ${x.name}` : ty(x);

/**
 * Display-only names for the calls SwapChan builds for "Get it back" (recover page, find_money claims, sweeps).
 * This only labels the built tx so the user sees exactly what they sign; it never decides whether a call is safe.
 */
const LABELS = parseAbi([
  "function withdraw()",
  "function exit()",
  "function getReward()",
  "function getReward(address account)",
  "function claim()",
  "function claim(uint256 index, address account, uint256 amount, bytes32[] merkleProof)",
  "function claimRewards()",
  "function claimFees()",
  "function vest()",
  "function mint(address gauge)",
  "function withdraw(uint256 amount)",
  "function redeem(uint256 shares, address receiver, address owner)",
  "function withdrawToken(address token, uint256 amount)",
  "function claimComp(address holder)",
  "function claimVenus(address holder)",
  "function claimWithdrawal(uint256 requestId)",
  "function claimCollateral()",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)",
  "function transfer(address to, uint256 amount)",
  "function withdrawMax(uint256 streamId, address to)",
]);

export interface CallSummary {
  /** contract the tx calls (tx.to) */
  contract: string;
  /** 4-byte selector from the calldata, "" for a plain transfer */
  selector: string;
  /** e.g. "claim(uint256 index, address account, uint256 amount, bytes32[] merkleProof)", or null when unknown */
  fn: string | null;
}

export function describeCall(to: string, data: string): CallSummary {
  const d = (data || "0x").toLowerCase();
  const selector = d.length >= 10 ? d.slice(0, 10) : "";
  if (!selector) return { contract: to, selector, fn: "plain transfer (no contract call)" };
  try {
    const c = decodeFunctionData({ abi: LABELS, data: d as `0x${string}` });
    const item = LABELS.find(
      (x) => x.name === c.functionName && x.inputs.length === (c.args?.length ?? 0),
    );
    return {
      contract: to,
      selector,
      fn: item ? `${item.name}(${item.inputs.map(par).join(", ")})` : c.functionName,
    };
  } catch {
    return { contract: to, selector, fn: null };
  }
}

/** One plain line for a signing prompt. */
export const callLine = (s: CallSummary) =>
  `${s.fn ? `${s.fn}${s.selector ? ` [${s.selector}]` : ""}` : `unknown function ${s.selector}`} on contract ${s.contract}`;

/** Block explorers SwapChan links contracts to (EVM chains it supports). Unknown chain = no link. */
const EXPLORER: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  10: "https://optimistic.etherscan.io",
  137: "https://polygonscan.com",
  56: "https://bscscan.com",
  43114: "https://snowtrace.io",
  59144: "https://lineascan.build",
  534352: "https://scrollscan.com",
};
export const explorerAddressUrl = (chainId: number, address: string): string | undefined =>
  EXPLORER[chainId] && /^0x[0-9a-fA-F]{40}$/.test(address)
    ? `${EXPLORER[chainId]}/address/${address}`
    : undefined;

const plain = (v: unknown): string =>
  typeof v === "bigint"
    ? v.toString()
    : Array.isArray(v)
      ? `[${v.map(plain).join(", ")}]`
      : v && typeof v === "object"
        ? `{ ${Object.entries(v)
            .map(([k, x]) => `${k}: ${plain(x)}`)
            .join(", ")} }`
        : String(v);

/** Decoded args in plain words ("amount (uint256) = 5"), [] when the call is unknown or has none. */
export function callArgs(data: string): { name: string; type: string; value: string }[] {
  try {
    const c = decodeFunctionData({
      abi: LABELS,
      data: (data || "0x").toLowerCase() as `0x${string}`,
    });
    const args = (c.args ?? []) as readonly unknown[];
    const item = LABELS.find((x) => x.name === c.functionName && x.inputs.length === args.length);
    return (item?.inputs ?? []).map((p, k) => ({
      name: p.name || `arg${k + 1}`,
      type: p.type,
      value: plain(args[k]),
    }));
  } catch {
    return [];
  }
}

/** The call descriptor the API attaches to each built tx (find_money steps, recovery package). */
export interface TxCall {
  chainId: number;
  chain: string;
  contract: string;
  contractExplorerUrl?: string;
  selector: string;
  function: string | null;
  signature: string | null;
  args: { name: string; type: string; value: string }[];
  plain: string;
}

/** Plain-words lines for a TxCall: function + selector, contract, then one line per arg. */
export function txCallLines(c: TxCall): string[] {
  const fn = c.signature
    ? `${c.signature} [${c.selector}]`
    : c.selector
      ? `unknown function [${c.selector}]`
      : "plain transfer (no contract call)";
  return [
    `Calls ${fn}`,
    `on contract ${c.contract} (${c.chain})`,
    ...c.args.map((a) => `${a.name} (${a.type}) = ${a.value}`),
  ];
}
