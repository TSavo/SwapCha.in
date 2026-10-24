/**
 * L2→L1 withdrawal tx builders:
 * - OP-Stack (Optimism, Base): proveWithdrawalTransaction + finalizeWithdrawalTransaction
 *   via viem/op-stack (eth_getProof under the hood).
 * - Arbitrum: Outbox.executeTransaction via NodeInterface.constructOutboxProof.
 *
 * Detection still lives in stuck.l2Withdrawals; this module builds the L1 txs when a
 * withdrawal hash / message is known.
 */
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, optimism, base, arbitrum } from "viem/chains";
import {
  buildProveWithdrawal,
  getWithdrawals,
  getWithdrawalStatus,
} from "viem/op-stack";

type F = typeof fetch;

const L2_TO_L1 = "0x4200000000000000000000000000000000000016" as const;

/** Official L1 portal / bridge contracts */
export const OP_PORTAL: Record<number, `0x${string}`> = {
  10: "0xbEb5Fc579115071764c7423A4f75eDEdA441eC71", // OptimismPortal2 (Fault Proofs)
  8453: "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e", // Base Portal
};

export const ARB_OUTBOX = "0x0B9857cC5d3EAd1bB9C3b03CE750455928EeBB40" as const;
export const ARB_NODE_INTERFACE = "0x00000000000000000000000000000000000000C8" as const;

const PUBLIC_RPC: Record<number, string> = {
  1: "https://ethereum.drpc.org",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
};

function client(chainId: number, env: NodeJS.ProcessEnv): PublicClient {
  const chain =
    chainId === 1 ? mainnet : chainId === 10 ? optimism : chainId === 8453 ? base : arbitrum;
  const url = env[`RPC_URL_${chainId}`] || PUBLIC_RPC[chainId] || chain.rpcUrls.default.http[0]!;
  return createPublicClient({ chain, transport: http(url, { timeout: 30_000 }) }) as PublicClient;
}

export type BuiltTx = {
  chainId: number;
  to: string;
  data: string;
  value: string;
  description: string;
};

/**
 * Build OP-Stack prove + finalize txs from an L2 initiation tx hash.
 * Uses viem/op-stack getWithdrawals → getWithdrawalStatus → buildProveWithdrawal.
 */
export async function buildOpStackWithdrawalTxs(
  env: NodeJS.ProcessEnv,
  l2ChainId: 10 | 8453,
  l2TxHash: Hex,
): Promise<{
  status: string;
  proveTx?: BuiltTx;
  finalizeTx?: BuiltTx;
  withdrawalHash?: Hex;
  error?: string;
}> {
  const portal = OP_PORTAL[l2ChainId];
  if (!portal) return { status: "unknown", error: "unsupported L2" };
  const l2 = client(l2ChainId, env);
  const l1 = client(1, env);
  try {
    const receipt = await l2.getTransactionReceipt({ hash: l2TxHash });
    const withdrawals = getWithdrawals(receipt);
    if (!withdrawals.length) return { status: "no-withdrawal", error: "no MessagePassed in receipt" };
    const withdrawal = withdrawals[0]!;
    // getWithdrawalStatus needs L1 portal + L2 client extended — use low-level path
    const status = await (getWithdrawalStatus as Function)(l1, {
      receipt,
      targetChain: l2.chain,
      chain: mainnet,
    }).catch(() => "waiting-to-prove");

    const statusStr = String(status);
    const out: {
      status: string;
      proveTx?: BuiltTx;
      finalizeTx?: BuiltTx;
      withdrawalHash?: Hex;
    } = {
      status: statusStr,
      withdrawalHash: withdrawal.withdrawalHash as Hex,
    };

    // Build prove when ready / waiting-to-prove — caller may still need a game/output.
    // Prefer portal.proveWithdrawalTransaction via buildProveWithdrawal when we can fetch a game.
    try {
      // Dynamic import of getGame / getL2Output from viem op-stack when available
      const op = await import("viem/op-stack");
      const getGame = (op as { getGame?: Function }).getGame;
      const getL2Output = (op as { getL2Output?: Function }).getL2Output;
      let gameOrOutput: { game?: unknown; output?: unknown } = {};
      if (getGame) {
        try {
          const l2Block = await l2.getBlock({ blockNumber: receipt.blockNumber });
          const game = await getGame(l1 as never, {
            l2BlockNumber: receipt.blockNumber,
            timestamp: l2Block.timestamp,
            targetChain: l2.chain as never,
          });
          gameOrOutput = { game };
        } catch (ge) {
          // Fallback: getGames and pick one that covers this block
          const getGames = (op as { getGames?: Function }).getGames;
          if (getGames) {
            try {
              const games = await getGames(l1 as never, {
                l2BlockNumber: receipt.blockNumber,
                targetChain: l2.chain as never,
                limit: 5,
              });
              const g = Array.isArray(games) ? games[0] : (games as { games?: unknown[] })?.games?.[0];
              if (g) gameOrOutput = { game: g };
            } catch {}
          }
          if (!gameOrOutput.game) throw ge;
        }
      }
      if (!gameOrOutput.game && getL2Output) {
        try {
          const output = await getL2Output(l1 as never, {
            l2BlockNumber: receipt.blockNumber,
            targetChain: l2.chain as never,
          });
          gameOrOutput = { output };
        } catch {}
      }
      if (gameOrOutput.game || gameOrOutput.output) {
        const l2Block = await l2.getBlock({ blockNumber: receipt.blockNumber });
        let built: unknown;
        try {
          built = await buildProveWithdrawal(l1 as never, {
            withdrawal,
            game: gameOrOutput.game,
            output: gameOrOutput.output,
            account: "0x0000000000000000000000000000000000000001" as never,
            targetChain: l2.chain as never,
          } as never);
        } catch (be) {
          // Retry with explicit l2Timestamp alignment
          built = await buildProveWithdrawal(l1 as never, {
            withdrawal,
            game: gameOrOutput.game,
            output: gameOrOutput.output,
            account: "0x0000000000000000000000000000000000000001" as never,
            targetChain: l2.chain as never,
            l2Timestamp: l2Block.timestamp,
          } as never);
          void be;
        }
        // encode proveWithdrawalTransaction
        const data = encodeFunctionData({
          abi: [
            parseAbiItem(
              "function proveWithdrawalTransaction((uint256 nonce,address sender,address target,uint256 value,uint256 gasLimit,bytes data),uint256 l2OutputIndex,(bytes32 version,bytes32 stateRoot,bytes32 messagePasserStorageRoot,bytes32 latestBlockhash) outputRootProof,bytes[] withdrawalProof)",
            ),
          ],
          functionName: "proveWithdrawalTransaction",
          args: [
            {
              nonce: withdrawal.nonce,
              sender: withdrawal.sender,
              target: withdrawal.target,
              value: withdrawal.value,
              gasLimit: withdrawal.gasLimit,
              data: withdrawal.data,
            },
            (built as { l2OutputIndex: bigint }).l2OutputIndex,
            (built as { outputRootProof: unknown }).outputRootProof as never,
            (built as { withdrawalProof: Hex[] }).withdrawalProof,
          ],
        });
        out.proveTx = {
          chainId: 1,
          to: portal,
          data,
          value: "0",
          description: `proveWithdrawalTransaction: ${l2ChainId === 10 ? "Optimism" : "Base"} L2→L1`,
        };
      }
    } catch (e) {
      out.status = `${statusStr}; prove-build: ${(e as Error).message?.slice(0, 120)}`;
    }

    // Fallback: eth_getProof against L2ToL1MessagePasser at the withdrawal's L2 block
    // (works for classic fault/output proofs; Super Roots may still need game-specific path)
    if (!out.proveTx) {
      try {
        const op = await import("viem/op-stack");
        const getWithdrawalHashStorageSlot = (op as { getWithdrawalHashStorageSlot?: Function })
          .getWithdrawalHashStorageSlot;
        const getGame2 = (op as { getGame?: Function }).getGame;
        if (getWithdrawalHashStorageSlot) {
          const slot = getWithdrawalHashStorageSlot({ withdrawalHash: withdrawal.withdrawalHash }) as Hex;
          const proof = await l2.getProof({
            address: L2_TO_L1,
            storageKeys: [slot],
            blockNumber: receipt.blockNumber,
          });
          const l2Block = await l2.getBlock({ blockNumber: receipt.blockNumber });
          let gameIndex = 0n;
          if (getGame2) {
            try {
              const game = await getGame2(l1 as never, {
                l2BlockNumber: receipt.blockNumber,
                targetChain: l2.chain as never,
              });
              gameIndex = BigInt((game as { index: bigint }).index);
            } catch {}
          }
          const storageProof = proof.storageProof[0]?.proof ?? [];
          if (storageProof.length && l2Block.hash && l2Block.stateRoot) {
            const data = encodeFunctionData({
              abi: [
                parseAbiItem(
                  "function proveWithdrawalTransaction((uint256 nonce,address sender,address target,uint256 value,uint256 gasLimit,bytes data),uint256 l2OutputIndex,(bytes32 version,bytes32 stateRoot,bytes32 messagePasserStorageRoot,bytes32 latestBlockhash) outputRootProof,bytes[] withdrawalProof)",
                ),
              ],
              functionName: "proveWithdrawalTransaction",
              args: [
                {
                  nonce: withdrawal.nonce,
                  sender: withdrawal.sender,
                  target: withdrawal.target,
                  value: withdrawal.value,
                  gasLimit: withdrawal.gasLimit,
                  data: withdrawal.data,
                },
                gameIndex,
                {
                  version: "0x0000000000000000000000000000000000000000000000000000000000000000",
                  stateRoot: l2Block.stateRoot,
                  messagePasserStorageRoot: proof.storageHash,
                  latestBlockhash: l2Block.hash,
                },
                storageProof,
              ],
            });
            out.proveTx = {
              chainId: 1,
              to: getAddress(portal),
              data,
              value: "0",
              description: `proveWithdrawalTransaction (eth_getProof): ${l2ChainId === 10 ? "Optimism" : "Base"} L2→L1`,
            };
            out.status = `${out.status}; eth_getProof-prove-ready`;
          }
        }
      } catch (pe) {
        out.status = `${out.status}; eth_getProof: ${(pe as Error).message?.slice(0, 80)}`;
      }
    }

    // finalizeWithdrawalTransaction — only args is the withdrawal tuple
    const finalizeData = encodeFunctionData({
      abi: [
        parseAbiItem(
          "function finalizeWithdrawalTransaction((uint256 nonce,address sender,address target,uint256 value,uint256 gasLimit,bytes data))",
        ),
      ],
      functionName: "finalizeWithdrawalTransaction",
      args: [
        {
          nonce: withdrawal.nonce,
          sender: withdrawal.sender,
          target: withdrawal.target,
          value: withdrawal.value,
          gasLimit: withdrawal.gasLimit,
          data: withdrawal.data,
        },
      ],
    });
    out.finalizeTx = {
      chainId: 1,
      to: getAddress(portal),
      data: finalizeData,
      value: "0",
      description: `finalizeWithdrawalTransaction: ${l2ChainId === 10 ? "Optimism" : "Base"} L2→L1`,
    };
    return out;
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

/**
 * Arbitrum: constructOutboxProof via NodeInterface on L2, then build L1 Outbox.executeTransaction.
 * size = send count at confirmation; leaf = index of the message.
 */
export async function buildArbOutboxExecuteTx(
  env: NodeJS.ProcessEnv,
  params: {
    size: bigint;
    leaf: bigint;
    /** Pre-fetched from L2 NodeInterface.constructOutboxProof(size, leaf) */
    proof?: Hex[];
    /** Outbox executeTransaction args (from the L2→L1 message) */
    message: {
      to: `0x${string}`;
      l2Sender: `0x${string}`;
      l1Block: bigint;
      l2Block: bigint;
      l2Timestamp: bigint;
      value: bigint;
      data: Hex;
    };
  },
): Promise<{ proofTx?: BuiltTx; executeTx: BuiltTx; proof: Hex[]; error?: string }> {
  const l2 = client(42161, env);
  let proof = params.proof ?? [];
  if (!proof.length) {
    try {
      const result = await l2.readContract({
        address: ARB_NODE_INTERFACE,
        abi: [
          parseAbiItem(
            "function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 sendRoot, bytes32 root, bytes32[] proof)",
          ),
        ],
        functionName: "constructOutboxProof",
        args: [params.size, params.leaf],
      });
      const tuple = result as unknown as readonly [Hex, Hex, readonly Hex[]];
      proof = [...(tuple[2] ?? [])];
    } catch (e) {
      return {
        proof: [],
        executeTx: {
          chainId: 1,
          to: ARB_OUTBOX,
          data: "0x",
          value: "0",
          description: "executeTransaction (proof failed)",
        },
        error: `constructOutboxProof: ${(e as Error).message}`,
      };
    }
  }
  const m = params.message;
  const data = encodeFunctionData({
    abi: [
      parseAbiItem(
        "function executeTransaction(bytes32[] proof,uint256 index,address l2Sender,address to,uint256 l2Block,uint256 l1Block,uint256 l2Timestamp,uint256 value,bytes data)",
      ),
    ],
    functionName: "executeTransaction",
    args: [
      proof,
      params.leaf,
      m.l2Sender,
      m.to,
      m.l2Block,
      m.l1Block,
      m.l2Timestamp,
      m.value,
      m.data,
    ],
  });
  return {
    proof,
    executeTx: {
      chainId: 1,
      to: ARB_OUTBOX,
      data,
      value: "0",
      description: `Outbox.executeTransaction(leaf=${params.leaf}): Arbitrum L2→L1`,
    },
  };
}

/** Find a recent L2→L1 initiation tx for owner (explorer) to live-verify builders. */
export async function findRecentOpWithdrawal(
  f: F,
  env: NodeJS.ProcessEnv,
  l2ChainId: 10 | 8453,
  owner: `0x${string}`,
): Promise<Hex | null> {
  const api =
    l2ChainId === 10
      ? "https://api-optimistic.etherscan.io/api"
      : "https://api.basescan.org/api";
  const key =
    l2ChainId === 10
      ? env.OPTIMISM_ETHERSCAN_KEY ?? env.ETHERSCAN_KEY ?? ""
      : env.BASESCAN_KEY ?? env.ETHERSCAN_KEY ?? "";
  try {
    const url = `${api}?module=account&action=txlist&address=${owner}&sort=desc&page=1&offset=100${key ? `&apikey=${key}` : ""}`;
    const r = await f(url, { signal: AbortSignal.timeout(15_000) }).then((x) => x.json()) as {
      result?: { to: string; hash: string; isError: string; input: string }[];
    };
    const hit = (Array.isArray(r.result) ? r.result : []).find(
      (t) =>
        t.to?.toLowerCase() === L2_TO_L1.toLowerCase() &&
        t.isError !== "1" &&
        t.input &&
        t.input !== "0x",
    );
    return (hit?.hash as Hex) ?? null;
  } catch {
    return null;
  }
}

void PUBLIC_RPC;
