/**
 * Perps balances.
 *  - Hyperliquid: clearinghouseState (perp margin, withdrawable, open positions) and spotClearinghouseState.
 *    Withdrawing is a Hyperliquid-signed action (not an EVM tx), so these are reported with a plain note, no tx.
 *  - GMX v2 (Arbitrum): unclaimed funding fees per market/token from the DataStore → ExchangeRouter.claimFundingFees
 *    (receiver = the owner, simulated first). Open v2 positions are counted and reported as a plain note
 *    (closing needs a keeper-executed order with an execution fee).
 */
import { safeReason } from "./reasons.js";
import { formatUnits, getAddress, type Hex, parseAbi } from "viem";
import { btKeccak256, encodeAbiParameters, encodeFunctionData } from "./blocktools.js";
import type { Found } from "./intel.js";
import { evmClient, json, prices, pxOf } from "./onchain.js";

type F = typeof fetch;
type Out = { items: Found[]; notChecked: string[] };
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function hyperliquidBalances(f: F, owner: string): Promise<Found[]> {
  const user = owner.toLowerCase();
  const post = <T>(type: string) =>
    json<T>(
      f,
      "https://api.hyperliquid.xyz/info",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, user }),
      },
      8_000,
    );
  const [perp, spot] = await Promise.all([
    post<{
      marginSummary: { accountValue: string };
      withdrawable: string;
      assetPositions: { position: { coin: string; szi: string; unrealizedPnl: string } }[];
    }>("clearinghouseState"),
    post<{ balances: { coin: string; total: string; entryNtl: string }[] }>(
      "spotClearinghouseState",
    ),
  ]);
  const out: Found[] = [];
  const av = Number(perp.marginSummary?.accountValue ?? 0),
    wd = Number(perp.withdrawable ?? 0);
  const pos = (perp.assetPositions ?? []).filter((p) => Number(p.position.szi) !== 0);
  if (av > 0.01 || pos.length) {
    out.push({
      kind: "claimable",
      protocol: "Hyperliquid perps",
      chainId: 42161,
      what: `Hyperliquid perp account value $${r2(av)} (withdrawable now $${r2(wd)})${
        pos.length
          ? `; ${pos.length} open position${pos.length > 1 ? "s" : ""}: ${pos
              .slice(0, 5)
              .map((p) => `${p.position.coin} ${p.position.szi}`)
              .join(", ")}`
          : ""
      }`,
      valueUsd: r2(av),
      action:
        "Withdrawals are signed inside Hyperliquid (not an EVM transaction); SwapChan cannot build this one",
      evidence: [
        {
          chainId: 42161,
          address: "api.hyperliquid.xyz",
          call: "clearinghouseState",
          args: [user],
          raw: String(av),
        },
      ],
      confidence: "high",
    } as Found);
  }
  const sb = (spot.balances ?? []).filter((b) => Number(b.total) > 0);
  if (sb.length) {
    const usdc = sb.find((b) => b.coin === "USDC");
    out.push({
      kind: "claimable",
      protocol: "Hyperliquid spot",
      chainId: 42161,
      what: `Hyperliquid spot balances: ${sb
        .slice(0, 8)
        .map((b) => `${Number(b.total).toPrecision(5)} ${b.coin}`)
        .join(", ")}`,
      valueUsd: usdc ? r2(Number(usdc.total)) : null,
      action:
        "Spot balances move out via Hyperliquid-signed actions; SwapChan cannot build this one",
      evidence: [
        {
          chainId: 42161,
          address: "api.hyperliquid.xyz",
          call: "spotClearinghouseState",
          args: [user],
          raw: String(sb.length),
        },
      ],
      confidence: "high",
    } as Found);
  }
  return out;
}

const DATASTORE = "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8" as const;
const READER = "0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789" as const;
// GMX rotates ExchangeRouter; the first that simulates (i.e. currently holds CONTROLLER) is used
const ROUTERS = [
  "0x7dE39FF2e232A2203196788d37e234cF8F1b83f1",
  "0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41",
] as const;
const DS = parseAbi([
  "function getUint(bytes32) view returns (uint256)",
  "function getBytes32Count(bytes32) view returns (uint256)",
]);
const RD = parseAbi([
  "function getMarkets(address dataStore,uint256 start,uint256 end) view returns ((address marketToken,address indexToken,address longToken,address shortToken)[])",
]);
const ER = parseAbi([
  "function claimFundingFees(address[] markets,address[] tokens,address receiver) payable returns (uint256[])",
]);
const ERC = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const h = (s: string) => btKeccak256(encodeAbiParameters([{ type: "string" }], [s]));
const FUND = h("CLAIMABLE_FUNDING_AMOUNT"),
  POSLIST = h("ACCOUNT_POSITION_LIST");

export async function gmxV2(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Found[]> {
  const own = getAddress(owner),
    c = evmClient(42161, env);
  const [markets, npos] = await Promise.all([
    c.readContract({
      address: READER,
      abi: RD,
      functionName: "getMarkets",
      args: [DATASTORE, 0n, 500n],
    }),
    c.readContract({
      address: DATASTORE,
      abi: DS,
      functionName: "getBytes32Count",
      args: [
        btKeccak256(
          encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [POSLIST, own]),
        ),
      ],
    }),
  ]);
  const pairs = markets.flatMap((m) =>
    [...new Set([m.longToken, m.shortToken])].map((t) => ({ m: m.marketToken, t })),
  );
  const amts = await c.multicall({
    contracts: pairs.map(
      (p) =>
        ({
          address: DATASTORE,
          abi: DS,
          functionName: "getUint",
          args: [
            btKeccak256(
              encodeAbiParameters(
                [
                  { type: "bytes32" },
                  { type: "address" },
                  { type: "address" },
                  { type: "address" },
                ],
                [FUND, p.m, p.t, own],
              ),
            ),
          ],
        }) as const,
    ),
  });
  const hits = pairs
    .map((p, i) => ({ ...p, a: (amts[i]!.result as bigint | undefined) ?? 0n }))
    .filter((x) => x.a > 0n);
  const out: Found[] = [];
  if (hits.length) {
    const toks = [...new Set(hits.map((x) => x.t))];
    const meta = await c.multicall({
      contracts: toks.flatMap(
        (t) =>
          [
            { address: t, abi: ERC, functionName: "decimals" },
            { address: t, abi: ERC, functionName: "symbol" },
          ] as const,
      ),
    });
    const px = await prices(
      f,
      toks.map((address) => ({ chainId: 42161, address })),
    ).catch(() => new Map());
    const info = new Map(
      toks.map((t, i) => [
        t,
        {
          d: Number(meta[2 * i]!.result ?? 18),
          s: String(meta[2 * i + 1]!.result ?? t.slice(0, 8)),
          p: pxOf(px, 42161, t)?.price ?? null,
        },
      ]),
    );
    let usd = 0,
      priced = false;
    const parts = hits.map((x) => {
      const m = info.get(x.t)!;
      const n = Number(formatUnits(x.a, m.d));
      if (m.p) {
        usd += n * m.p;
        priced = true;
      }
      return `${n.toPrecision(5)} ${m.s}`;
    });
    const data = encodeFunctionData({
      abi: ER,
      functionName: "claimFundingFees",
      args: [hits.map((x) => x.m), hits.map((x) => x.t), own],
    });
    let ROUTER: string | null = null;
    for (const r of ROUTERS)
      if (
        await c.call({ account: own, to: r, data }).then(
          () => true,
          () => false,
        )
      ) {
        ROUTER = r;
        break;
      }
    const ok = ROUTER !== null;
    out.push({
      kind: "claimable",
      protocol: "GMX v2 funding fees",
      chainId: 42161,
      what: `Unclaimed GMX v2 funding fees: ${parts.slice(0, 8).join(", ")}`,
      valueUsd: priced ? r2(usd) : null,
      ...(ok
        ? {
            claimTx: {
              chainId: 42161,
              to: ROUTER!,
              data,
              value: "0",
              description: `GMX ExchangeRouter.claimFundingFees (${hits.length} market/token) → your wallet`,
            },
          }
        : {}),
      action: ok
        ? "Sign claimFundingFees, then swap on SwapChan"
        : "Claim simulation reverted; no tx offered",
      evidence: [
        {
          chainId: 42161,
          address: DATASTORE,
          call: "getUint(CLAIMABLE_FUNDING_AMOUNT)",
          args: [own],
          raw: String(hits.length),
        },
      ],
      confidence: "high",
    } as Found);
  }
  if (npos > 0n)
    out.push({
      kind: "lead",
      protocol: "GMX v2 positions",
      chainId: 42161,
      what: `${npos} open GMX v2 position${npos > 1n ? "s" : ""} (collateral still in the market)`,
      valueUsd: null,
      action:
        "Closing needs a keeper-executed GMX order with an execution fee; SwapChan does not build it",
      evidence: [
        {
          chainId: 42161,
          address: DATASTORE,
          call: "getBytes32Count(ACCOUNT_POSITION_LIST)",
          args: [own],
          raw: String(npos),
        },
      ],
      confidence: "high",
    } as Found);
  return out;
}

export async function perpsBalances(f: F, env: NodeJS.ProcessEnv, owner: string): Promise<Out> {
  const notChecked: string[] = [];
  const lim = <T>(n: string, p: Promise<T[]>, ms: number) =>
    Promise.race([
      p,
      new Promise<T[]>((_, r) => setTimeout(() => r(new Error("timeout")), ms)),
    ]).catch(
      (e) => (
        notChecked.push(`${n}: not checked (${safeReason(e)})`), [] as T[]
      ),
    );
  const [a, b] = await Promise.all([
    lim("Hyperliquid", hyperliquidBalances(f, owner), 9_000),
    lim("GMX v2", gmxV2(f, env, owner), 10_000),
  ]);
  return { items: [...a, ...b], notChecked };
}
