/**
 * ICO / DAO refunds still paying out on-chain.
 *  - TheDAO (2016): the hard-fork WithdrawDAO contract still holds ETH and pays 1 wei per DAO base unit
 *    (100 DAO = 1 ETH). Two steps: approve WithdrawDAO for the DAO balance, then withdraw(). SwapChan builds
 *    whichever step is next; the withdraw step is simulated from the owner before it is offered.
 */
import { formatEther, getAddress, parseAbi } from "viem";
import { encodeFunctionData } from "./blocktools.js";
import type { Found } from "./intel.js";
import { evmClient, prices, pxOf } from "./onchain.js";

type F = typeof fetch;
const DAO = "0xBB9bc244D798123fDe783fCc1C72d3Bb8C189413" as const;
const WITHDRAW_DAO = "0xBf4eD7b27F1d666546E30D74d50d173d20bca754" as const;
const ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function withdraw()",
]);
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function daoRefunds(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Found[]> {
  const own = getAddress(owner),
    c = evmClient(1, env);
  const [bal, allow, pool] = await Promise.all([
    c.readContract({ address: DAO, abi: ABI, functionName: "balanceOf", args: [own] }),
    c.readContract({
      address: DAO,
      abi: ABI,
      functionName: "allowance",
      args: [own, WITHDRAW_DAO],
    }),
    c.getBalance({ address: WITHDRAW_DAO }),
  ]);
  if (bal === 0n) return [];
  const eth = Number(formatEther(bal));
  const px = await prices(f, [
    { chainId: 1, address: "0x0000000000000000000000000000000000000000" },
  ]).catch(() => new Map());
  const p = pxOf(px, 1, "0x0000000000000000000000000000000000000000")?.price ?? null;
  const approved = allow >= bal;
  const data = approved
    ? encodeFunctionData({ abi: ABI, functionName: "withdraw" })
    : encodeFunctionData({ abi: ABI, functionName: "approve", args: [WITHDRAW_DAO, bal] });
  const to = approved ? WITHDRAW_DAO : DAO;
  const ok =
    pool >= bal &&
    (await c.call({ account: own, to, data }).then(
      () => true,
      () => false,
    ));
  return [
    {
      kind: "claimable",
      protocol: "TheDAO refund (WithdrawDAO)",
      chainId: 1,
      what: `${(Number(bal) / 1e16).toFixed(2)} DAO tokens = ${eth.toPrecision(6)} ETH refundable from the 2016 hard-fork WithdrawDAO contract`,
      valueUsd: p ? r2(eth * p) : null,
      ...(ok
        ? {
            claimTx: {
              chainId: 1,
              to,
              data,
              value: "0",
              description: approved
                ? "WithdrawDAO.withdraw() → ETH to your wallet"
                : "Step 1 of 2: approve WithdrawDAO to take your DAO tokens (then come back for withdraw())",
            },
          }
        : {}),
      action: ok
        ? approved
          ? "Sign withdraw(), then swap ETH on SwapChan"
          : "Sign the approval; find_money then builds withdraw()"
        : "Simulation reverted or refund pool too small; no tx offered",
      underlying: "0x0000000000000000000000000000000000000000",
      evidence: [
        { chainId: 1, address: DAO, call: "balanceOf(address)", args: [own], raw: String(bal) },
      ],
      confidence: "high",
    } as Found,
  ];
}
