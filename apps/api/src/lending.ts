/**
 * Lending / yield decoders for the verify_tx guard: ERC-4626 vaults (Morpho vaults), Morpho Blue,
 * Morpho Bundler3, Merkl Distributor, Aave v3 Pool and Pendle RouterV4.
 *
 * Rules: the beneficiary (receiver / onBehalf / onBehalfOf / to / owner / users[]) must be the
 * signer; the target must be an allowlisted protocol contract (or a vault / market that the
 * protocol's own on-chain factory confirms). A known lending selector on any other target, or any
 * other beneficiary, is high (danger). Read-only: no signing, no txs.
 *
 * ABIs come from the protocols' public sources (selectors re-checked against the openchain
 * signature database): ERC-4626 (EIP-4626), morpho-org/morpho-blue src/interfaces/IMorpho.sol,
 * morpho-org/bundler3 src/interfaces/IBundler3.sol, AngleProtocol/merkl-contracts
 * contracts/Distributor.sol, aave-dao/aave-v3-origin src/contracts/interfaces/IPool.sol,
 * pendle-finance/pendle-core-v2-public contracts/interfaces/IPAction*V3.sol + IPAllActionTypeV3.sol.
 */
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  parseAbi,
} from "viem";

const lc = (s?: string) => (s ?? "").toLowerCase();

const ERC4626 = parseAbi([
  "function deposit(uint256 assets, address receiver)",
  "function mint(uint256 shares, address receiver)",
  "function withdraw(uint256 assets, address receiver, address owner)",
  "function redeem(uint256 shares, address receiver, address owner)",
]);
const MP =
  "(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)";
const MORPHO_BLUE = parseAbi([
  `function supply(${MP} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)`,
  `function withdraw(${MP} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)`,
  `function borrow(${MP} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)`,
  `function repay(${MP} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)`,
  `function supplyCollateral(${MP} marketParams, uint256 assets, address onBehalf, bytes data)`,
  `function withdrawCollateral(${MP} marketParams, uint256 assets, address onBehalf, address receiver)`,
]);
const BUNDLER3 = parseAbi([
  "function multicall((address to, bytes data, uint256 value, bool skipRevert, bytes32 callbackHash)[] bundle)",
]);
const MERKL = parseAbi([
  "function claim(address[] users, address[] tokens, uint256[] amounts, bytes32[][] proofs)",
]);
const AAVE_POOL = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)",
  "function withdraw(address asset, uint256 amount, address to)",
]);
const PENDLE_STRUCTS = [
  "struct SwapData { uint8 swapType; address extRouter; bytes extCalldata; bool needScale; }",
  "struct TokenInput { address tokenIn; uint256 netTokenIn; address tokenMintSy; address pendleSwap; SwapData swapData; }",
  "struct TokenOutput { address tokenOut; uint256 minTokenOut; address tokenRedeemSy; address pendleSwap; SwapData swapData; }",
  "struct ApproxParams { uint256 guessMin; uint256 guessMax; uint256 guessOffchain; uint256 maxIteration; uint256 eps; }",
  "struct Order { uint256 salt; uint256 expiry; uint256 nonce; uint8 orderType; address token; address YT; address maker; address receiver; uint256 makingAmount; uint256 lnImpliedRate; uint256 failSafeRate; bytes permit; }",
  "struct FillOrderParams { Order order; bytes signature; uint256 makingAmount; }",
  "struct LimitOrderData { address limitRouter; uint256 epsSkipMarket; FillOrderParams[] normalFills; FillOrderParams[] flashFills; bytes optData; }",
] as const;
/** Every listed function takes (address receiver, address market|YT|SY, ...). */
const PENDLE_ROUTER = parseAbi([
  ...PENDLE_STRUCTS,
  "function swapExactTokenForPt(address receiver, address market, uint256 minPtOut, ApproxParams guessPtOut, TokenInput input, LimitOrderData limit)",
  "function swapExactSyForPt(address receiver, address market, uint256 exactSyIn, uint256 minPtOut, ApproxParams guessPtOut, LimitOrderData limit)",
  "function swapExactPtForToken(address receiver, address market, uint256 exactPtIn, TokenOutput output, LimitOrderData limit)",
  "function swapExactPtForSy(address receiver, address market, uint256 exactPtIn, uint256 minSyOut, LimitOrderData limit)",
  "function swapExactTokenForPtSimple(address receiver, address market, uint256 minPtOut, TokenInput input)",
  "function swapExactSyForPtSimple(address receiver, address market, uint256 exactSyIn, uint256 minPtOut)",
  "function swapExactTokenForYtSimple(address receiver, address market, uint256 minYtOut, TokenInput input)",
  "function swapExactSyForYtSimple(address receiver, address market, uint256 exactSyIn, uint256 minYtOut)",
  "function addLiquidityDualTokenAndPt(address receiver, address market, TokenInput input, uint256 netPtDesired, uint256 minLpOut)",
  "function addLiquidityDualSyAndPt(address receiver, address market, uint256 netSyDesired, uint256 netPtDesired, uint256 minLpOut)",
  "function addLiquiditySinglePt(address receiver, address market, uint256 netPtIn, uint256 minLpOut, ApproxParams guessPtSwapToSy, LimitOrderData limit)",
  "function addLiquiditySingleToken(address receiver, address market, uint256 minLpOut, ApproxParams guessPtReceivedFromSy, TokenInput input, LimitOrderData limit)",
  "function addLiquiditySingleSy(address receiver, address market, uint256 netSyIn, uint256 minLpOut, ApproxParams guessPtReceivedFromSy, LimitOrderData limit)",
  "function addLiquiditySingleTokenKeepYt(address receiver, address market, uint256 minLpOut, uint256 minYtOut, TokenInput input)",
  "function addLiquiditySingleSyKeepYt(address receiver, address market, uint256 netSyIn, uint256 minLpOut, uint256 minYtOut)",
  "function addLiquiditySinglePtSimple(address receiver, address market, uint256 netPtIn, uint256 minLpOut)",
  "function addLiquiditySingleTokenSimple(address receiver, address market, uint256 minLpOut, TokenInput input)",
  "function addLiquiditySingleSySimple(address receiver, address market, uint256 netSyIn, uint256 minLpOut)",
  "function redeemPyToToken(address receiver, address YT, uint256 netPyIn, TokenOutput output)",
  "function redeemPyToSy(address receiver, address YT, uint256 netPyIn, uint256 minSyOut)",
  "function redeemSyToToken(address receiver, address SY, uint256 netSyIn, TokenOutput output)",
]);
const READS = parseAbi([
  "function isMetaMorpho(address target) view returns (bool)",
  "function asset() view returns (address)",
  "function isValidMarket(address market) view returns (bool)",
  "function readTokens() view returns (address SY, address PT, address YT)",
  "function isYT(address token) view returns (bool)",
  "function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
]);
export const LENDING_ABIS = {
  ERC4626,
  MORPHO_BLUE,
  BUNDLER3,
  MERKL,
  AAVE_POOL,
  PENDLE_ROUTER,
  READS,
};

export interface Protocols {
  aavePool?: string;
  morphoBlue?: string;
  /** MetaMorpho factories: a vault counts only if one of these returns isMetaMorpho(vault) = true. */
  metaMorphoFactories?: string[];
  bundler3?: string;
  /** Bundler3 adapters a bundle may call. */
  bundlerAdapters?: string[];
  merklDistributor?: string;
  pendleRouter?: string;
  /** Pendle market factories: market valid only if one returns isValidMarket(market) = true. */
  pendleMarketFactories?: string[];
  /** Pendle yield-contract factories: YT valid only if one returns isYT(yt) = true. */
  pendleYieldFactories?: string[];
}

/**
 * Per-chain allowlist. Each address: primary source cited, then cross-checked against a second
 * source (explorer-verified contract or on-chain read, below). Anything not confirmed twice is left
 * out (those calls stay judged by the generic checks).
 *
 * Primary sources:
 *  [M]  Morpho docs addresses page, https://docs.morpho.org/get-started/resources/addresses/
 *  [A1] bgd-labs/aave-address-book src/AaveV3Ethereum.sol   [A8453] src/AaveV3Base.sol
 *  [P1] pendle-finance/pendle-core-v2-public deployments/1-core.json   [P8453] deployments/8453-core.json
 *  [MK] Merkl docs, https://developers.merkl.xyz/resources/chains-and-contracts
 * Second sources (eth_call on public RPCs, 2026-10-28):
 *  Aave Pool        PoolAddressesProvider.getPool() == POOL and Pool.ADDRESSES_PROVIDER() round-trip
 *  Morpho Blue      MetaMorpho factory MORPHO() and GeneralAdapter1 MORPHO() == Morpho Blue
 *  MetaMorpho fac.  MORPHO() == Morpho Blue
 *  Bundler3/adapter GeneralAdapter1.BUNDLER3() == Bundler3
 *  Pendle factories marketFactory.yieldContractFactory() == paired yield factory in the same file
 *  Pendle router    marketFactoryV6 / router code present; Etherscan-verified PendleRouterV4
 *  Merkl            Etherscan tag "Angle Protocol: Distributor"; code present on Base
 */
export const PROTOCOLS: Record<number, Protocols> = {
  1: {
    aavePool: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // [A1] POOL
    morphoBlue: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb", // [M] Morpho
    metaMorphoFactories: [
      "0x1897a8997241c1cd4bd0698647e4eb7213535c24", // [M] MetaMorpho Factory V1.1
      "0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101", // [M] MetaMorpho Factory [OLD]
    ],
    bundler3: "0x6566194141eefa99af43bb5aa71460ca2dc90245", // [M] Bundler3
    bundlerAdapters: ["0x4a6c312ec70e8747a587ee860a0353cd42be0ae0"], // [M] EthereumGeneralAdapter1
    merklDistributor: "0x3ef3d8ba38ebe18db133cec108f4d14ce00dd9ae", // [MK] Distributor
    pendleRouter: "0x888888888889758f76e7103c6cbf23abbf58f946", // [P1] router
    pendleMarketFactories: [
      "0x27b1dacd74688af24a64bd3c9c1b143118740784", // [P1] marketFactory
      "0x1a6fcc85557bc4fb7b534ed835a03ef056552d52", // [P1] marketFactoryV3
      "0x3d75bd20c983edb5fd218a1b7e0024f1056c7a2f", // [P1] marketFactoryV4
      "0x6fcf753f2c67b83f7b09746bbc4fa0047b35d050", // [P1] marketFactoryV5
      "0x6d247b1c044fa1e22e6b04fa9f71baf99eb29a9f", // [P1] marketFactoryV6
    ],
    pendleYieldFactories: [
      "0x70ee0a6db4f5a2dc4d9c0b57be97b9987e75bafd", // [P1] yieldContractFactory
      "0xdf3601014686674e53d1fa52f7602525483f9122", // [P1] yieldContractFactoryV3
      "0x273b4bfa3bb30fe8f32c467b5f0046834557f072", // [P1] yieldContractFactoryV4
      "0x35a338522a435d46f77be32c70e215b813d0e3ac", // [P1] yieldContractFactoryV5
      "0x3e6eba46abc5ab18ed95f6667d8b2fd4020e4637", // [P1] yieldContractFactoryV6
    ],
  },
  8453: {
    aavePool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", // [A8453] POOL
    morphoBlue: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb", // [M] Base Morpho
    metaMorphoFactories: [
      "0xff62a7c278c62ed665133147129245053bbf5918", // [M] Base MetaMorpho Factory V1.1
      "0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101", // [M] Base MetaMorpho Factory [OLD]
    ],
    bundler3: "0x6bfd8137e702540e7a42b74178a4a49ba43920c4", // [M] Base Bundler3
    bundlerAdapters: ["0xb98c948cfa24072e58935bc004a8a7b376ae746a"], // [M] Base GeneralAdapter1
    merklDistributor: "0x3ef3d8ba38ebe18db133cec108f4d14ce00dd9ae", // [MK] Distributor
    pendleRouter: "0x888888888889758f76e7103c6cbf23abbf58f946", // [P8453] router
    pendleMarketFactories: [
      "0x59968008a703dc13e6beaeced644bdce4ee45d13", // [P8453] marketFactoryV5
      "0x81e80a50e56d10c501ff17b5fe2f662bd9ea4590", // [P8453] marketFactoryV6
    ],
    pendleYieldFactories: [
      "0x963ddbb35c1ae44e2a159e3b5fb5177e0b32660d", // [P8453] yieldContractFactoryV5
      "0xddbfa21ecf024971486684e4e1600998adeabc88", // [P8453] yieldContractFactoryV6
    ],
  },
};

/** Fixed (non-vault) contracts an exact approve may go to without a warning. */
export function allowlistedSpenders(chainId: number): Set<string> {
  const p = PROTOCOLS[chainId];
  if (!p) return new Set();
  return new Set(
    [p.aavePool, p.morphoBlue, p.pendleRouter, ...(p.bundlerAdapters ?? [])]
      .filter((x): x is string => !!x)
      .map(lc),
  );
}

export interface LendingDecoded {
  protocol: "erc4626" | "morpho-blue" | "morpho-bundler3" | "merkl" | "aave-v3" | "pendle";
  fn: string;
  /** Addresses that must equal the signer. */
  beneficiaries: { role: string; address: string }[];
  args: readonly unknown[];
}

function tryAbi(abi: readonly unknown[], data: Hex) {
  try {
    return decodeFunctionData({ abi: abi as never, data }) as {
      functionName: string;
      args: readonly unknown[];
    };
  } catch {
    return null;
  }
}

/** Pure: which lending call (if any) the calldata is. */
export function decodeLending(data: Hex): LendingDecoded | null {
  if (!data || data.length < 10) return null;
  let d = tryAbi(ERC4626, data);
  if (d) {
    const a = d.args;
    const b =
      d.functionName === "deposit" || d.functionName === "mint"
        ? [{ role: "receiver", address: String(a[1]) }]
        : [
            { role: "receiver", address: String(a[1]) },
            { role: "owner", address: String(a[2]) },
          ];
    return { protocol: "erc4626", fn: d.functionName, beneficiaries: b, args: a };
  }
  d = tryAbi(MORPHO_BLUE, data);
  if (d) {
    const a = d.args;
    const fn = d.functionName;
    const b: { role: string; address: string }[] = [];
    if (fn === "supplyCollateral") b.push({ role: "onBehalf", address: String(a[2]) });
    else if (fn === "withdrawCollateral")
      b.push(
        { role: "onBehalf", address: String(a[2]) },
        { role: "receiver", address: String(a[3]) },
      );
    else {
      b.push({ role: "onBehalf", address: String(a[3]) });
      if (fn === "withdraw" || fn === "borrow") b.push({ role: "receiver", address: String(a[4]) });
    }
    return { protocol: "morpho-blue", fn, beneficiaries: b, args: a };
  }
  d = tryAbi(AAVE_POOL, data);
  if (d) {
    const a = d.args;
    const fn = d.functionName;
    const i = fn === "borrow" ? 4 : fn === "repay" ? 3 : 2;
    const role = fn === "withdraw" ? "to" : "onBehalfOf";
    return { protocol: "aave-v3", fn, beneficiaries: [{ role, address: String(a[i]) }], args: a };
  }
  d = tryAbi(MERKL, data);
  if (d) {
    const users = d.args[0] as readonly string[];
    return {
      protocol: "merkl",
      fn: "claim",
      beneficiaries: users.map((u, i) => ({ role: `users[${i}]`, address: u })),
      args: d.args,
    };
  }
  d = tryAbi(PENDLE_ROUTER, data);
  if (d)
    return {
      protocol: "pendle",
      fn: d.functionName,
      beneficiaries: [{ role: "receiver", address: String(d.args[0]) }],
      args: d.args,
    };
  d = tryAbi(BUNDLER3, data);
  if (d) return { protocol: "morpho-bundler3", fn: "multicall", beneficiaries: [], args: d.args };
  return null;
}

type Sev = "critical" | "high" | "warn" | "info";
export interface LendingResult {
  decoded: LendingDecoded | null;
  findings: { severity: Sev; check: string; message: string }[];
  /** Tokens whose arrival at the signer counts as value received (shares, aTokens, PT/LP, borrowed asset). */
  credit: Set<string>;
  /** Tokens the signer is expected to spend; losing any other counted token is high. */
  spend?: Set<string>;
  /** The protocol books a position instead of sending a token back (repay, supplyCollateral, Blue supply). */
  position: boolean;
  /** Bundles: trusted only with a successful simulation. */
  needsSimulation: boolean;
}

/** Minimal client surface (viem PublicClient.call). */
export interface Reader {
  call: (a: { to: Hex; data: Hex }) => Promise<unknown>;
}
async function read<T>(c: Reader, to: string, fn: string, args: unknown[] = []): Promise<T | null> {
  try {
    const data = encodeFunctionData({ abi: READS, functionName: fn as never, args: args as never });
    const r = (await c.call({ to: to as Hex, data })) as { data?: Hex } | Hex | undefined;
    const raw = typeof r === "string" ? r : r?.data;
    if (!raw || raw === "0x") return null;
    return decodeFunctionResult({ abi: READS, functionName: fn as never, data: raw }) as T;
  } catch {
    return null;
  }
}
async function anyTrue(c: Reader, factories: string[] | undefined, fn: string, arg: string) {
  const r = await Promise.all((factories ?? []).map((f) => read<boolean>(c, f, fn, [arg])));
  return r.some((x) => x === true);
}

/** On-chain: is `vault` a MetaMorpho vault per Morpho's own factory? Returns its asset() if so. */
export async function confirmMorphoVault(c: Reader, chainId: number, vault: string) {
  const p = PROTOCOLS[chainId];
  if (!p?.metaMorphoFactories?.length) return null;
  if (!(await anyTrue(c, p.metaMorphoFactories, "isMetaMorpho", vault))) return null;
  const asset = await read<string>(c, vault, "asset");
  return asset ? lc(asset) : null;
}

/**
 * Lending checks for one tx. `from` is the signer (the guard's owner). Pure decode plus a few
 * read-only eth_calls for vault/market confirmation; fails closed (unconfirmed means high).
 */
export async function lendingChecks(
  c: Reader,
  chainId: number,
  tx: { from?: string | undefined; to: string; data: Hex },
): Promise<LendingResult> {
  const res: LendingResult = {
    decoded: decodeLending(tx.data),
    findings: [],
    credit: new Set(),
    position: false,
    needsSimulation: false,
  };
  const d = res.decoded;
  if (!d) return res;
  const add = (severity: Sev, check: string, message: string) =>
    res.findings.push({ severity, check, message });
  const me = lc(tx.from);
  const to = lc(tx.to);
  const p = PROTOCOLS[chainId] ?? {};
  const name = `${d.protocol} ${d.fn}`;
  const bad = d.beneficiaries.filter((b) => !me || lc(b.address) !== me);
  for (const b of bad)
    add(
      "high",
      "lending-beneficiary",
      me
        ? `${name}: ${b.role} is ${b.address}, not your wallet. The position or funds go to someone else.`
        : `${name}: ${b.role} is ${b.address}; pass from so it can be checked against your wallet.`,
    );
  const ok = bad.length === 0;
  const unknownTarget = (what: string) =>
    add(
      "high",
      "lending-target",
      `${name} sent to ${tx.to}, which is not the ${what} on this chain (lookalike or unsupported chain).`,
    );

  switch (d.protocol) {
    case "erc4626": {
      const asset = await confirmMorphoVault(c, chainId, to);
      if (!asset) {
        add(
          "high",
          "lending-vault",
          `${tx.to} is not a vault confirmed by Morpho's on-chain vault factory: do not deposit into an unverified vault.`,
        );
        break;
      }
      if (!ok) break;
      if (d.fn === "deposit" || d.fn === "mint") {
        res.credit.add(to); // the vault share token
        res.spend = new Set([asset]);
      } else res.credit.add(asset);
      add(
        "info",
        "lending",
        `${name} on a Morpho-confirmed vault (asset ${asset}), to your wallet.`,
      );
      break;
    }
    case "morpho-blue": {
      if (!p.morphoBlue || to !== p.morphoBlue) {
        unknownTarget("Morpho Blue contract");
        break;
      }
      if (!ok) break;
      const mp = d.args[0] as { loanToken: string; collateralToken: string };
      const loan = lc(mp.loanToken);
      const coll = lc(mp.collateralToken);
      if (d.fn === "borrow" || d.fn === "withdraw") res.credit.add(loan);
      else if (d.fn === "withdrawCollateral") res.credit.add(coll);
      else {
        res.position = true;
        res.spend = new Set([d.fn === "supplyCollateral" ? coll : loan]);
      }
      add("info", "lending", `${name} on Morpho Blue for your wallet.`);
      break;
    }
    case "aave-v3": {
      if (!p.aavePool || to !== p.aavePool) {
        unknownTarget("Aave v3 Pool");
        break;
      }
      if (!ok) break;
      const asset = lc(String(d.args[0]));
      if (d.fn === "supply" || d.fn === "deposit") {
        const rd = await read<readonly unknown[]>(c, to, "getReserveData", [asset]);
        const aToken = rd ? lc(String(rd[8])) : "";
        if (aToken && !/^0x0{40}$/.test(aToken)) res.credit.add(aToken);
        else res.position = true; // aToken unknown: the pool still books the supply to you
        res.spend = new Set([asset]);
      } else if (d.fn === "repay") {
        res.position = true;
        res.spend = new Set([asset]);
      } else res.credit.add(asset); // borrow / withdraw
      add("info", "lending", `${name} on the Aave v3 Pool for your wallet.`);
      break;
    }
    case "merkl": {
      if (!p.merklDistributor || to !== p.merklDistributor) {
        add(
          "warn",
          "lending-target",
          `claim() on ${tx.to}, which is not Merkl's Distributor: judged by the simulation only.`,
        );
        break;
      }
      if (!ok) break;
      for (const t of d.args[1] as readonly string[]) res.credit.add(lc(t));
      add("info", "lending", "Merkl reward claim to your wallet.");
      break;
    }
    case "pendle": {
      if (!p.pendleRouter || to !== p.pendleRouter) {
        unknownTarget("Pendle router");
        break;
      }
      if (!ok) break;
      const second = lc(String(d.args[1]));
      if (d.fn === "redeemSyToToken") {
        add("warn", "lending", "Pendle SY redeem: the SY contract cannot be confirmed on-chain.");
        break;
      }
      if (d.fn.startsWith("redeemPy")) {
        if (!(await anyTrue(c, p.pendleYieldFactories, "isYT", second))) {
          add(
            "high",
            "lending-market",
            `${second} is not a YT from Pendle's yield-contract factory.`,
          );
          break;
        }
        add("info", "lending", `${name} via the Pendle router, to your wallet.`);
        break; // payout token (TokenOutput / SY) is judged by the generic checks
      }
      if (!(await anyTrue(c, p.pendleMarketFactories, "isValidMarket", second))) {
        add("high", "lending-market", `${second} is not a market from Pendle's market factory.`);
        break;
      }
      res.credit.add(second); // LP token is the market itself
      const t = await read<readonly string[]>(c, second, "readTokens");
      if (t) for (const x of t) res.credit.add(lc(x)); // SY, PT, YT
      add(
        "info",
        "lending",
        `${name} via the Pendle router on a factory-confirmed market, to your wallet.`,
      );
      break;
    }
    case "morpho-bundler3": {
      if (!p.bundler3 || to !== p.bundler3) {
        unknownTarget("Morpho Bundler3");
        break;
      }
      const calls = d.args[0] as readonly { to: string }[];
      const adapters = new Set((p.bundlerAdapters ?? []).map(lc));
      const stray = calls.filter((x) => !adapters.has(lc(x.to)));
      if (stray.length)
        add(
          "high",
          "lending-bundle",
          `Bundle calls contracts outside Morpho's adapters: ${stray.map((x) => x.to).join(", ")}.`,
        );
      res.needsSimulation = true;
      add(
        "warn",
        "lending-bundle",
        "Morpho Bundler3 batch: inner steps are judged by the simulation (what you lose and what comes back).",
      );
      break;
    }
  }
  return res;
}
