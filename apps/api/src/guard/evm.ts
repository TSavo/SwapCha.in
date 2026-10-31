import { type Hex, parseAbi, parseAbiParameters } from "viem";
import { btSelector, decodeAbiParameters, decodeFunctionData } from "../blocktools.js";

/** Router ABIs we decode (selectors observed live on each provider's routes, 2026-10). */
export const ABIS = {
  oneinch: parseAbi([
    "function swap(address executor,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data)",
    "function unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex)",
    "function unoswap2(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2)",
    "function unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)",
    "function unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex)",
    "function unoswapTo2(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2)",
    "function unoswapTo3(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)",
    "function ethUnoswap(uint256 minReturn,uint256 dex)",
    "function ethUnoswap2(uint256 minReturn,uint256 dex,uint256 dex2)",
    "function ethUnoswap3(uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)",
    "function ethUnoswapTo(uint256 to,uint256 minReturn,uint256 dex)",
    "function ethUnoswapTo2(uint256 to,uint256 minReturn,uint256 dex,uint256 dex2)",
    "function ethUnoswapTo3(uint256 to,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)",
  ]),
  kyber: parseAbi([
    "struct Desc { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
    "function swap((address callTarget,address approveTarget,bytes targetData,Desc desc,bytes clientData) execution)",
    "function swapSimpleMode(address caller,Desc desc,bytes executorData,bytes clientData)",
  ]),
  velora: parseAbi([
    "function swapExactAmountIn(address executor,(address srcToken,address destToken,uint256 fromAmount,uint256 toAmount,uint256 quotedAmount,bytes32 metadata,address beneficiary) swapData,uint256 partnerAndFee,bytes permit,bytes executorData)",
    "function swapExactAmountInOnUniswapV3((address srcToken,address destToken,uint256 fromAmount,uint256 toAmount,uint256 quotedAmount,bytes32 metadata,address beneficiary,bytes pools) uniData,uint256 partnerAndFee,bytes permit)",
    "function swapExactAmountInOnUniswapV2((address srcToken,address destToken,uint256 fromAmount,uint256 toAmount,uint256 quotedAmount,bytes32 metadata,address beneficiary,bytes pools) uniData,uint256 partnerAndFee,bytes permit)",
  ]),
  zerox: parseAbi([
    "function exec(address operator,address token,uint256 amount,address target,bytes data)",
    "function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zid)",
  ]),
  lifi: parseAbi([
    "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
    "function swapTokensGeneric(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData[] swapData)",
    "function swapTokensMultipleV3ERC20ToERC20(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData[] swapData)",
    "function swapTokensMultipleV3ERC20ToNative(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData[] swapData)",
    "function swapTokensMultipleV3NativeToERC20(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData[] swapData)",
    "function swapTokensSingleV3ERC20ToERC20(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData swapData)",
    "function swapTokensSingleV3ERC20ToNative(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData swapData)",
    "function swapTokensSingleV3NativeToERC20(bytes32 txId,string integrator,string referrer,address receiver,uint256 minAmountOut,SwapData swapData)",
  ]),
  across: parseAbi([
    "function deposit(bytes32 depositor,bytes32 recipient,bytes32 inputToken,bytes32 outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityParameter,bytes message)",
    "function depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message)",
  ]),
  relay: parseAbi([
    "function depositNative(address depositor,bytes32 id)",
    "function depositErc20(address depositor,address token,uint256 amount,bytes32 id)",
    "function multicall((address target,bool allowFailure,uint256 value,bytes callData)[] calls,address refundTo,address nftRecipient,bytes metadata)",
    "function transferAndMulticall(address[] tokens,uint256[] amounts,(address target,bool allowFailure,uint256 value,bytes callData)[] calls,address refundTo,address nftRecipient,bytes metadata)",
  ]),
  debridge: parseAbi([
    "struct Order { address giveTokenAddress; uint256 giveAmount; bytes takeTokenAddress; uint256 takeAmount; uint256 takeChainId; bytes receiverDst; address givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes externalCall; bytes allowedCancelBeneficiarySrc; }",
    "function createSaltedOrder(Order order,uint64 salt,bytes affiliateFee,uint32 referralCode,bytes permitEnvelope,bytes metadata)",
    "function createOrder(Order order,bytes affiliateFee,uint32 referralCode,bytes permitEnvelope)",
  ]),
  thorchain: parseAbi([
    "function depositWithExpiry(address vault,address asset,uint256 amount,string memo,uint256 expiration)",
  ]),
  erc20: parseAbi(["function approve(address spender,uint256 amount)"]),
} as const;

/** LI.FI facets all take BridgeData as their first argument. */
const BRIDGE_DATA = parseAbiParameters(
  "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)",
);

export interface Decoded {
  fn: string;
  /** Output recipient; "sender" = msg.sender (the taker). */
  recipient?: string | "sender";
  /** Bytes-encoded recipient (deBridge/Across non-EVM). Lowercase hex, no 0x. */
  recipientBytes?: string;
  minOut?: bigint;
  /** Bridges whose min is on the input side (LI.FI BridgeData). */
  inputMin?: bigint;
  inAmount?: bigint;
  inToken?: string | undefined;
  outToken?: string;
  /** Address that must be the taker (depositor / refund / order authority). */
  owners?: string[];
  /** Has a destination-side call: recipient is a handler contract. */
  dstCall?: boolean;
  /** 0x AllowanceHolder inner target (Settler). */
  target?: string;
  dstChainId?: bigint;
  memo?: string;
  vault?: string;
  dstAuthorityBytes?: string;
}

const addr = (u: bigint) => `0x${(u & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}`;
const b32addr = (b: Hex) => `0x${b.slice(-40)}`.toLowerCase();
const lc = (s: string) => s.toLowerCase();

function tryDecode(abi: readonly unknown[], data: Hex) {
  try {
    return decodeFunctionData({ abi: abi as never, data }) as unknown as {
      functionName: string;
      args: readonly unknown[];
    };
  } catch {
    return null;
  }
}

/** Decode a router call into the fields the guard checks. Null = unknown selector. */
export function decodeEvm(provider: string, data: Hex): Decoded | null {
  const key = (
    {
      "1inch": "oneinch",
      kyberswap: "kyber",
      velora: "velora",
      "0x": "zerox",
      lifi: "lifi",
      across: "across",
      relay: "relay",
      debridge: "debridge",
      thorchain: "thorchain",
    } as const
  )[provider];
  if (!key) return null;
  const d = tryDecode(ABIS[key], data);
  if (!d) {
    if (key !== "lifi") return null;
    try {
      const [b] = decodeAbiParameters(BRIDGE_DATA, `0x${data.slice(10)}`) as unknown as [
        {
          bridge: string;
          receiver: string;
          minAmount: bigint;
          sendingAssetId: string;
          destinationChainId: bigint;
          hasSourceSwaps: boolean;
          hasDestinationCall: boolean;
        },
      ];
      return {
        fn: `lifi-bridge:${b.bridge}`,
        recipient: lc(b.receiver),
        inputMin: b.minAmount,
        inToken: b.hasSourceSwaps ? undefined : lc(b.sendingAssetId),
        dstChainId: b.destinationChainId,
        dstCall: b.hasDestinationCall,
      };
    } catch {
      return null;
    }
  }
  const a = d.args as any[];
  const fn = d.functionName;
  switch (key) {
    case "oneinch": {
      if (fn === "swap") {
        const x = a[1];
        return {
          fn,
          recipient: lc(x.dstReceiver),
          minOut: x.minReturnAmount,
          inAmount: x.amount,
          inToken: lc(x.srcToken),
          outToken: lc(x.dstToken),
        };
      }
      // unoswap*: recipient is msg.sender unless *To; output token comes from the pool path.
      const to = fn.includes("To") ? addr(a[0]) : "sender";
      const off = fn.includes("To") ? 1 : 0;
      if (fn.startsWith("eth")) return { fn, recipient: to, minOut: a[off] };
      return { fn, recipient: to, inToken: addr(a[off]), inAmount: a[off + 1], minOut: a[off + 2] };
    }
    case "kyber": {
      const x = fn === "swap" ? a[0].desc : a[1];
      return {
        fn,
        recipient: lc(x.dstReceiver),
        minOut: x.minReturnAmount,
        inAmount: x.amount,
        inToken: lc(x.srcToken),
        outToken: lc(x.dstToken),
      };
    }
    case "velora": {
      const x = fn === "swapExactAmountIn" ? a[1] : a[0];
      const ben = lc(x.beneficiary);
      return {
        fn,
        recipient: /^0x0{40}$/.test(ben) ? "sender" : ben,
        minOut: x.toAmount,
        inAmount: x.fromAmount,
        inToken: lc(x.srcToken),
        outToken: lc(x.destToken),
      };
    }
    case "zerox": {
      if (fn === "exec") {
        const inner = tryDecode(ABIS.zerox, a[4]);
        const s = inner?.functionName === "execute" ? (inner.args as any[])[0] : null;
        return {
          fn,
          target: lc(a[3]),
          inToken: lc(a[1]),
          inAmount: a[2],
          ...(s
            ? { recipient: lc(s.recipient), outToken: lc(s.buyToken), minOut: s.minAmountOut }
            : {}),
        };
      }
      const s = a[0];
      return { fn, recipient: lc(s.recipient), outToken: lc(s.buyToken), minOut: s.minAmountOut };
    }
    case "lifi":
      return { fn, recipient: lc(a[3]), minOut: a[4] };
    case "across": {
      const v3 = fn === "depositV3";
      const conv = (x: string) => (v3 ? lc(x) : b32addr(x as Hex));
      return {
        fn,
        owners: [conv(a[0])],
        recipient: conv(a[1]),
        recipientBytes: v3 ? lc(a[1]).slice(2) : lc(a[1]).slice(2),
        inToken: conv(a[2]),
        inAmount: a[4],
        minOut: a[5],
        dstChainId: a[6],
        dstCall: a[11] !== "0x",
      };
    }
    case "relay": {
      if (fn === "depositNative") return { fn, owners: [lc(a[0])] };
      if (fn === "depositErc20")
        return { fn, owners: [lc(a[0])], inToken: lc(a[1]), inAmount: a[2] };
      const refund = lc(fn === "multicall" ? a[1] : a[3]);
      return { fn, owners: [refund] };
    }
    case "debridge": {
      const o = a[0];
      return {
        fn,
        recipientBytes: lc(o.receiverDst).slice(2),
        minOut: o.takeAmount,
        inAmount: o.giveAmount,
        inToken: lc(o.giveTokenAddress),
        dstChainId: o.takeChainId,
        owners: [lc(o.givePatchAuthoritySrc)],
        // order authority on the destination controls cancel/patch: must be the recipient too.
        dstAuthorityBytes: lc(o.orderAuthorityAddressDst).slice(2),
        dstCall: o.externalCall !== "0x",
      };
    }
    case "thorchain":
      return { fn, vault: lc(a[0]), inToken: lc(a[1]), inAmount: a[2], memo: a[3] };
    default:
      return null;
  }
}

export function decodeApprove(data: Hex): { spender: string; amount: bigint } | null {
  const d = tryDecode(ABIS.erc20, data);
  if (!d) return null;
  const [spender, amount] = d.args as [string, bigint];
  return { spender: lc(spender), amount };
}

export const SELECTOR_APPROVE = btSelector("approve(address,uint256)");

/**
 * LI.FI non-EVM bridge facets (BridgeData.receiver = 0x11f1… sentinel): the real destination
 * lives in the facet-specific data. Layouts reverse-engineered from live ETH->BTC quotes (2026-10):
 *  - layerswap 0x4c279d6b (BridgeData, SwapData[], LayerSwapData): facet tuple
 *      [id, depositAddr, refund, nonEVMReceiver, sigOffset, deadline, sig]
 *  - near      0x02631b09 (BridgeData, SwapData[], NearData): facet tuple
 *      [nonEVMReceiver, token, depositAddr, quoteHash, deadline, minOut, refund, sigOffset, sig]
 *  - relaydepository 0xa3443faa (BridgeData, SwapData[], {orderId, depositor}): no on-chain
 *      receiver; Relay binds it to orderId off-chain.
 * nonEVMReceiver for Bitcoin is the bech32 witness program as 5-bit words (no version), 32 bytes.
 */
export interface LifiNonEvm {
  bridge: string;
  /** bytes32 receiver, lowercase hex no 0x; undefined = bound off-chain. */
  receiver?: string;
  /** Address that gets refunds / is the depositor: must be the taker. */
  refund: string;
}
const word = (data: Hex, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64).toLowerCase();
export function lifiNonEvm(data: Hex): LifiNonEvm | null {
  const sel = data.slice(0, 10).toLowerCase();
  let b: { bridge: string };
  try {
    [b] = decodeAbiParameters(BRIDGE_DATA, `0x${data.slice(10)}`) as unknown as [
      { bridge: string },
    ];
  } catch {
    return null;
  }
  const at = (w: string) => Number(BigInt(`0x${w}`) / 32n);
  if (sel === "0x4c279d6b" && b.bridge === "layerswap") {
    const f = at(word(data, 2));
    return {
      bridge: b.bridge,
      receiver: word(data, f + 3),
      refund: `0x${word(data, f + 2).slice(24)}`,
    };
  }
  if (sel === "0x02631b09" && b.bridge === "near") {
    const f = at(word(data, 2));
    return {
      bridge: b.bridge,
      receiver: word(data, f),
      refund: `0x${word(data, f + 6).slice(24)}`,
    };
  }
  if (sel === "0xa3443faa" && b.bridge === "relaydepository")
    return { bridge: b.bridge, refund: `0x${word(data, 3).slice(24)}` };
  return null;
}
