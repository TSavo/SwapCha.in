/**
 * Canonical bridge withdrawals stuck half-way (L2 → Ethereum).
 *  - Optimism: L2StandardBridge WithdrawalInitiated + MessagePasser MessagePassed logs for the wallet (full history via
 *    the public OP RPC). Status from the L1 portal. Ready-to-prove → proveWithdrawalTransaction; ready-to-finalize →
 *    finalizeWithdrawalTransactionExternalProof (works whoever proved it). Finalized ones are dropped.
 *  - Base: no free full-history log source → "not checked" line (honest gap).
 *  - Arbitrum: ArbSys L2ToL1Tx (ETH, destination = wallet) + standard ERC-20 gateway WithdrawalInitiated (from = wallet)
 *    via the Etherscan v2 free tier. Unspent, confirmed messages → Outbox.executeTransaction with a NodeInterface proof.
 * Every tx is simulated on Ethereum from the wallet before it is offered.
 */
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseAbiItem,
} from "viem";
import { arbitrum, mainnet, optimism } from "viem/chains";
import { getWithdrawals, publicActionsL1, publicActionsL2 } from "viem/op-stack";
import type { Found } from "./intel.js";
import { json, prices, pxOf } from "./onchain.js";

type F = typeof fetch;
type Out = { items: Found[]; notChecked: string[] };
const r2 = (n: number) => Math.round(n * 100) / 100;
const L1_RPC = (env: NodeJS.ProcessEnv) => env.RPC_URL_1 || "https://ethereum-rpc.publicnode.com";
const OP_PORTAL = "0xbEb5Fc579115071764c7423A4f75eDEdA441eC71" as const;
const ARB_OUTBOX = "0x0B9857ae2D4A3DBe74ffE1d7DF045bb7F96E4840" as const;
const NODE_IFACE = "0x00000000000000000000000000000000000000C8" as const;
const WTX =
  "(uint256 nonce,address sender,address target,uint256 value,uint256 gasLimit,bytes data)";
const PORTAL = parseAbi([
  `function proveWithdrawalTransaction(${WTX} _tx,uint256 _disputeGameIndex,(bytes32 version,bytes32 stateRoot,bytes32 messagePasserStorageRoot,bytes32 latestBlockhash) _outputRootProof,bytes[] _withdrawalProof)`,
  `function finalizeWithdrawalTransactionExternalProof(${WTX} _tx,address _proofSubmitter)`,
  "function proofSubmitters(bytes32,uint256) view returns (address)",
]);
const ETH0 = "0x0000000000000000000000000000000000000000";

async function ethPx(f: F) {
  const px = await prices(f, [{ chainId: 1, address: ETH0 }]).catch(() => new Map());
  return pxOf(px, 1, ETH0)?.price ?? null;
}

export async function opWithdrawals(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Found[]> {
  const own = getAddress(owner);
  const l2 = createPublicClient({
    chain: optimism,
    transport: http(env.RPC_URL_10 || "https://mainnet.optimism.io", { timeout: 10_000 }),
  }).extend(publicActionsL2());
  const l1 = createPublicClient({
    chain: mainnet,
    transport: http(L1_RPC(env), { timeout: 10_000 }),
  }).extend(publicActionsL1());
  const [a, b] = await Promise.all([
    l2.getLogs({
      address: "0x4200000000000000000000000000000000000010",
      event: parseAbiItem(
        "event WithdrawalInitiated(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)",
      ),
      args: { from: own },
      fromBlock: 0n,
      toBlock: "latest",
    }),
    l2.getLogs({
      address: "0x4200000000000000000000000000000000000016",
      event: parseAbiItem(
        "event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)",
      ),
      args: { sender: own },
      fromBlock: 0n,
      toBlock: "latest",
    }),
  ]);
  const amt = new Map<string, { token: string; amount: bigint }>();
  for (const l of a) amt.set(l.transactionHash, { token: l.args.l1Token!, amount: l.args.amount! });
  for (const l of b)
    if (!amt.has(l.transactionHash))
      amt.set(l.transactionHash, { token: ETH0, amount: l.args.value! });
  const hashes = [...amt.keys()].slice(-25);
  const p = await ethPx(f);
  const rows = await Promise.all(
    hashes.map(async (h) => {
      const receipt = await l2.getTransactionReceipt({ hash: h as Hex });
      const status = await l1.getWithdrawalStatus({ receipt, targetChain: optimism });
      if (status === "finalized") return null;
      const [w] = getWithdrawals(receipt);
      if (!w) return null;
      let data: Hex | null = null;
      if (status === "ready-to-prove") {
        const game = await l1.getGame({
          l2BlockNumber: receipt.blockNumber,
          targetChain: optimism,
        });
        const args = (await l2.buildProveWithdrawal({
          withdrawal: w,
          game,
        } as never)) as unknown as {
          l2OutputIndex: bigint;
          outputRootProof: never;
          withdrawalProof: Hex[];
        };
        data = encodeFunctionData({
          abi: PORTAL,
          functionName: "proveWithdrawalTransaction",
          args: [w as never, args.l2OutputIndex, args.outputRootProof, args.withdrawalProof],
        });
      } else if (status === "ready-to-finalize") {
        const sub = await l1.readContract({
          address: OP_PORTAL,
          abi: PORTAL,
          functionName: "proofSubmitters",
          args: [w.withdrawalHash, 0n],
        });
        data = encodeFunctionData({
          abi: PORTAL,
          functionName: "finalizeWithdrawalTransactionExternalProof",
          args: [w as never, sub],
        });
      }
      const ok =
        !!data &&
        (await l1.call({ account: own, to: OP_PORTAL, data: data! }).then(
          () => true,
          () => false,
        ));
      return { h, status, data, ok, ...amt.get(h)! };
    }),
  );
  return rows
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => {
      const isEth =
        x.token === ETH0 || x.token.toLowerCase() === "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000";
      const n = isEth ? Number(formatEther(x.amount)) : null;
      const step =
        x.status === "ready-to-prove"
          ? "prove"
          : x.status === "ready-to-finalize"
            ? "finalize"
            : null;
      return {
        kind: step ? "claimable" : "lead",
        protocol: "Optimism bridge withdrawal",
        chainId: 1,
        what: `L2→L1 withdrawal ${x.h.slice(0, 10)}… ${isEth ? `${n!.toPrecision(6)} ETH` : `token ${x.token.slice(0, 10)}… amount ${x.amount}`}: ${x.status}`,
        valueUsd: n !== null && p ? r2(n * p) : null,
        ...(x.ok
          ? {
              claimTx: {
                chainId: 1,
                to: OP_PORTAL,
                data: x.data!,
                value: "0",
                description: `OptimismPortal ${step} withdrawal ${x.h.slice(0, 10)}…`,
              },
            }
          : {}),
        action: x.ok
          ? `Sign the ${step} tx on Ethereum${step === "prove" ? ", then come back after the 7-day window to finalize" : ""}`
          : step
            ? `${step} simulation reverted; no tx offered`
            : "Waiting on the challenge window; no tx yet",
        underlying: isEth ? ETH0 : x.token,
        evidence: [
          {
            chainId: 10,
            address: "0x4200000000000000000000000000000000000016",
            call: "tx",
            args: [x.h],
            raw: x.status,
          },
        ],
        confidence: "high",
      } as Found;
    });
}

const L2TOL1 = parseAbiItem(
  "event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)",
);
const OUTBOX = parseAbi([
  "function isSpent(uint256) view returns (bool)",
  "function executeTransaction(bytes32[] proof,uint256 index,address l2Sender,address to,uint256 l2Block,uint256 l1Block,uint256 l2Timestamp,uint256 value,bytes data)",
]);
const pad = (a: string) => "0x" + a.toLowerCase().slice(2).padStart(64, "0");

export async function arbWithdrawals(
  f: F,
  env: NodeJS.ProcessEnv,
  owner: string,
): Promise<Found[]> {
  if (!env.ETHERSCAN_API_KEY) throw new Error("no explorer key");
  const own = getAddress(owner);
  const es1 = (q: string) =>
    json<{ status: string; result: { transactionHash: string }[] | string }>(
      f,
      `https://api.etherscan.io/v2/api?chainid=42161&module=logs&action=getLogs&fromBlock=0&toBlock=latest&${q}&apikey=${env.ETHERSCAN_API_KEY}`,
      undefined,
      10_000,
    ).then((r) => {
      if (Array.isArray(r.result)) return r.result;
      if (/no records/i.test(String((r as { message?: string }).message ?? r.result))) return [];
      throw new Error(`explorer error: ${String(r.result).slice(0, 80)}`);
    });
  const es = async (q: string, n = 0): Promise<{ transactionHash: string }[]> => {
    try {
      return await es1(q);
    } catch (e) {
      if (n < 3 && /rate limit/i.test(String(e))) {
        await new Promise((r) => setTimeout(r, 400 * (n + 1)));
        return es(q, n + 1);
      }
      throw e;
    }
  };
  const [eth, tok] = await Promise.all([
    es(
      `address=0x0000000000000000000000000000000000000064&topic0=0x3e7aafa77dbf186b7fd488006beff893744caa3c4f6f299e8a709fa2087374fc&topic0_1_opr=and&topic1=${pad(own)}`,
    ),
    es(
      `address=0x09e9222E96E7B4AE2a407B98d48e330053351EEe&topic0=0x3073a74ecb728d10be779fe19a74a1428e20468f5b4d167bf9c73d9067847d73&topic0_1_opr=and&topic1=${pad(own)}`,
    ),
  ]);
  const txs = [...new Set([...eth, ...tok].map((x) => x.transactionHash))].slice(-25);
  if (!txs.length) return [];
  const l2 = createPublicClient({
    chain: arbitrum,
    transport: http(env.RPC_URL_42161 || "https://arb1.arbitrum.io/rpc", { timeout: 10_000 }),
  });
  const l1 = createPublicClient({
    chain: mainnet,
    transport: http(L1_RPC(env), { timeout: 10_000 }),
  });
  // confirmed send count = sendCount of the L2 block behind the newest SendRootUpdated on the L1 outbox
  const head = await l1.getBlockNumber();
  const roots = await l1.getLogs({
    address: ARB_OUTBOX,
    event: parseAbiItem(
      "event SendRootUpdated(bytes32 indexed outputRoot, bytes32 indexed l2BlockHash)",
    ),
    fromBlock: head - 3_000n,
    toBlock: head,
  });
  const last = roots.at(-1);
  if (!last) throw new Error("no recent Arbitrum send root");
  const blk = (await l2.request({
    method: "eth_getBlockByHash" as never,
    params: [last.args.l2BlockHash, false] as never,
  })) as { sendCount?: string };
  const size = BigInt(blk.sendCount ?? "0");
  const msgs = (
    await Promise.all(txs.map((h) => l2.getTransactionReceipt({ hash: h as Hex })))
  ).flatMap((r) =>
    r.logs
      .filter((l) => l.address.toLowerCase() === "0x0000000000000000000000000000000000000064")
      .flatMap((l) => {
        try {
          return [
            {
              h: r.transactionHash,
              a: decodeEventLog({ abi: [L2TOL1], data: l.data, topics: l.topics }).args,
            },
          ];
        } catch {
          return [];
        }
      }),
  );
  const p = await ethPx(f);
  const out = await Promise.all(
    msgs.map(async ({ h, a }) => {
      const spent = await l1.readContract({
        address: ARB_OUTBOX,
        abi: OUTBOX,
        functionName: "isSpent",
        args: [a.position],
      });
      if (spent) return null;
      const confirmed = a.position < size;
      let data: Hex | null = null,
        ok = false;
      if (confirmed) {
        const [, , proof] = await l2.readContract({
          address: NODE_IFACE,
          abi: parseAbi([
            "function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 send, bytes32 root, bytes32[] proof)",
          ]),
          functionName: "constructOutboxProof",
          args: [size, a.position],
        });
        data = encodeFunctionData({
          abi: OUTBOX,
          functionName: "executeTransaction",
          args: [
            [...proof],
            a.position,
            a.caller,
            a.destination,
            a.arbBlockNum,
            a.ethBlockNum,
            a.timestamp,
            a.callvalue,
            a.data,
          ],
        });
        ok = await l1.call({ account: own, to: ARB_OUTBOX, data }).then(
          () => true,
          (e) => {
            if (env.DEBUG_BRIDGE) console.error(String(e.shortMessage ?? e).slice(0, 300));
            return false;
          },
        );
      }
      const n = Number(formatEther(a.callvalue)),
        isEth = a.callvalue > 0n;
      return {
        kind: confirmed ? "claimable" : "lead",
        protocol: "Arbitrum bridge withdrawal",
        chainId: 1,
        what: `L2→L1 message #${a.position} (tx ${h.slice(0, 10)}…)${isEth ? ` ${n.toPrecision(6)} ETH` : " token withdrawal"}: ${confirmed ? "confirmed, not executed on Ethereum" : "waiting for the ~7-day confirmation"}`,
        valueUsd: isEth && p ? r2(n * p) : null,
        ...(ok
          ? {
              claimTx: {
                chainId: 1,
                to: ARB_OUTBOX,
                data: data!,
                value: "0",
                description: `Arbitrum Outbox.executeTransaction(#${a.position})`,
              },
            }
          : {}),
        action: ok
          ? "Sign executeTransaction on Ethereum, then swap on SwapChan"
          : confirmed
            ? "Execute simulation reverted; no tx offered"
            : "Not confirmed yet; no tx until the dispute window ends",
        underlying: isEth ? ETH0 : undefined,
        evidence: [
          {
            chainId: 42161,
            address: "0x0000000000000000000000000000000000000064",
            call: "L2ToL1Tx",
            args: [h],
            raw: String(a.position),
          },
        ],
        confidence: "high",
      } as Found;
    }),
  );
  return out.filter((x): x is Found => !!x);
}

export async function bridgeWithdrawals(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Out> {
  const notChecked = ["Base bridge withdrawals: not checked (no free full-history log source)"];
  const lim = <T>(n: string, p: Promise<T[]>, ms: number) =>
    Promise.race([
      p,
      new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), ms)),
    ]).catch(
      (e) => (
        notChecked.push(`${n}: not checked (${String((e as Error).message).slice(0, 60)})`),
        [] as T[]
      ),
    );
  const [o, a] = await Promise.all([
    lim("Optimism bridge withdrawals", opWithdrawals(f, env, owner), 12_000),
    lim("Arbitrum bridge withdrawals", arbWithdrawals(f, env, owner), 12_000),
  ]);
  return { items: [...o, ...a], notChecked };
}
