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
