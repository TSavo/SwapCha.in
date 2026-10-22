"use client";

import { NATIVE_TOKEN, type Quote, type QuoteRequest, type Token } from "@swapchan/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, maxUint256 } from "viem";
import {
  useAccount,
  useBalance,
  useConfig,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { formatAmount, parseAmount, sanitizeAmountInput } from "@/lib/amount";
import { api } from "@/lib/api";
import { characterForChain } from "@/lib/characters";
import { Character, SpeechBubble } from "./Character";
import { ChainPicker, TokenPicker } from "./Pickers";
import { RouteList, RoutesLoading } from "./RouteList";
import { StatusTracker, type TrackParams } from "./StatusTracker";

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const SLIPPAGES = [10, 50, 100, 300];

const isNative = (t: Token | undefined) => t?.address.toLowerCase() === NATIVE_TOKEN.toLowerCase();

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

type Phase =
  | { k: "idle" }
  | { k: "approving" }
  | { k: "swapping" }
  | { k: "tracking"; p: TrackParams }
  | { k: "error"; msg: string };

export function SwapCard() {
  const config = useConfig();
  const { address, chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const [fromChain, setFromChain] = useState(1);
  const [toChain, setToChain] = useState(8453);
  const [fromToken, setFromToken] = useState<Token>();
  const [toToken, setToToken] = useState<Token>();
  const [amountStr, setAmountStr] = useState("");
  const [slippageBps, setSlippage] = useState(50);
  const [approveMode, setApproveMode] = useState<"exact" | "permit2">("exact");
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });

  const chains = useQuery({ queryKey: ["chains"], queryFn: api.chains });
  const fromTokens = useQuery({
    queryKey: ["tokens", fromChain],
    queryFn: () => api.tokens(fromChain),
  });
  const toTokens = useQuery({ queryKey: ["tokens", toChain], queryFn: () => api.tokens(toChain) });
  const mocked = Boolean(chains.data?.mocked || fromTokens.data?.mocked);

  // Default token selection per chain: native in, USDC (or first) out.
  useEffect(() => {
    const list = fromTokens.data?.data ?? [];
    if (!fromToken || fromToken.chainId !== fromChain) setFromToken(list.find(isNative) ?? list[0]);
  }, [fromTokens.data, fromChain, fromToken]);
  useEffect(() => {
    const list = toTokens.data?.data ?? [];
    if (!toToken || toToken.chainId !== toChain)
      setToToken(list.find((t) => t.symbol === "USDC") ?? list[0]);
  }, [toTokens.data, toChain, toToken]);

  const amount = fromToken ? parseAmount(amountStr, fromToken.decimals) : null;
  const amountInvalid = amountStr !== "" && amount === null;
  const debouncedAmount = useDebounced(amount, 400);

  const request: QuoteRequest | null = useMemo(
    () =>
      fromToken && toToken && debouncedAmount
        ? {
            fromChainId: fromChain,
            toChainId: toChain,
            fromToken: fromToken.address,
            toToken: toToken.address,
            amount: debouncedAmount.toString(),
            slippageBps,
            ...(address ? { taker: address } : {}),
          }
        : null,
    [fromChain, toChain, fromToken, toToken, debouncedAmount, slippageBps, address],
  );

  const quotes = useQuery({
    queryKey: ["quotes", request],
    queryFn: () => (request ? api.quotes(request) : Promise.reject(new Error("no request"))),
    enabled: request !== null && phase.k === "idle",
    refetchInterval: 20_000,
  });
  const qres = quotes.data?.data;
  useEffect(() => {
    if (qres && !qres.quotes.some((q) => q.id === selected)) setSelected(qres.best);
  }, [qres, selected]);
  const quote: Quote | undefined = qres?.quotes.find((q) => q.id === selected);
  const quotesMocked = quotes.data?.mocked ?? mocked;

  // Balances & allowance
  const nativeBal = useBalance({ address, chainId: fromChain, query: { enabled: !!address } });
  const erc20Bal = useReadContract({
    address: fromToken?.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: fromChain,
    query: { enabled: !!address && !!fromToken && !isNative(fromToken) },
  });
  const balance = isNative(fromToken) ? nativeBal.data?.value : erc20Bal.data;
  const spender = quote?.approvalAddress ?? null;
  const allowance = useReadContract({
    address: fromToken?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && spender ? [address, spender] : undefined,
    chainId: fromChain,
    query: { enabled: !!address && !!spender && !isNative(fromToken) && !quotesMocked },
  });
  const needsApproval =
    !!spender &&
    !isNative(fromToken) &&
    !quotesMocked &&
    amount !== null &&
    (allowance.data ?? 0n) < amount;
  const insufficient = balance !== undefined && amount !== null && balance < amount;

  const ensureChain = async () => {
    if (walletChain !== fromChain) await switchChainAsync({ chainId: fromChain });
  };

  const approve = async () => {
    if (!fromToken || !spender || amount === null) return;
    setPhase({ k: "approving" });
    try {
      await ensureChain();
      // Permit2 mode: one-time max approval to the canonical Permit2 contract when the
      // route's spender is Permit2. Otherwise approve exactly the swap amount.
      const value =
        approveMode === "permit2" && spender.toLowerCase() === PERMIT2.toLowerCase()
          ? maxUint256
          : amount;
      const hash = await writeContractAsync({
        address: fromToken.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, value],
        chainId: fromChain,
      });
      await waitForTransactionReceipt(config, { hash, chainId: fromChain });
      await allowance.refetch();
      setPhase({ k: "idle" });
    } catch (e) {
      setPhase({ k: "error", msg: (e as Error).message.split("\n")[0] ?? "Approval failed" });
    }
  };

  const swap = async () => {
    if (!quote || !address) return;
    setPhase({ k: "swapping" });
    try {
      if (quotesMocked) {
        // Demo mode: never send a real transaction against mock data.
        await new Promise((r) => setTimeout(r, 1200));
        const fake =
          `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}` as `0x${string}`;
        setPhase({
          k: "tracking",
          p: {
            provider: quote.provider,
            txHash: fake,
            fromChainId: fromChain,
            toChainId: toChain,
            mocked: true,
          },
        });
        return;
      }
      await ensureChain();
      const tx = quote.tx ?? (await api.build(quote, address, false));
      const hash = await sendTransactionAsync({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
        chainId: tx.chainId,
        ...(tx.gasLimit ? { gas: BigInt(tx.gasLimit) } : {}),
      });
      setPhase({
        k: "tracking",
        p: {
          provider: quote.provider,
          txHash: hash,
          fromChainId: fromChain,
          toChainId: toChain,
          mocked: false,
        },
      });
    } catch (e) {
      setPhase({ k: "error", msg: (e as Error).message.split("\n")[0] ?? "Swap failed" });
    }
  };

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setFromToken(toToken);
    setToToken(fromToken);
    setAmountStr("");
  };

  if (phase.k === "tracking") {
    return (
      <Card>
        <StatusTracker
          p={phase.p}
          onReset={() => {
            setPhase({ k: "idle" });
            setAmountStr("");
          }}
        />
      </Card>
    );
  }

  const chainList = chains.data?.data ?? [];
  const fromCh = characterForChain(fromChain);
  let cta: { label: string; action?: () => void } = { label: "Enter an amount" };
  if (!address) cta = { label: "Connect wallet to swap" };
  else if (amountInvalid) cta = { label: `Max ${fromToken?.decimals} decimals` };
  else if (amount === null) cta = { label: "Enter an amount" };
  else if (insufficient) cta = { label: `Not enough ${fromToken?.symbol}` };
  else if (!quote) cta = { label: quotes.isFetching ? "Finding routes…" : "No route" };
  else if (needsApproval)
    cta = {
      label: phase.k === "approving" ? "Approving…" : `Approve ${fromToken?.symbol}`,
      action: approve,
    };
  else
    cta = {
      label: phase.k === "swapping" ? "Confirm in wallet…" : quotesMocked ? "Swap (demo)" : "Swap!",
      action: swap,
    };
  const busy = phase.k === "approving" || phase.k === "swapping";

  return (
    <Card>
      {mocked && (
        <div
          className="mb-3 rounded-xl bg-amber-400/15 px-3 py-1.5 text-xs text-amber-200"
          data-testid="mock-banner"
        >
          Demo mode: API unreachable, showing mock routes. Nothing will be sent on-chain.
        </div>
      )}
      <section className="rounded-2xl bg-violet-900/50 p-3">
        <ChainPicker chains={chainList} value={fromChain} onChange={setFromChain} label="From" />
        <div className="mt-3 flex items-center gap-2">
          <input
            inputMode="decimal"
            aria-label="Amount"
            placeholder="0.0"
            value={amountStr}
            onChange={(e) => setAmountStr(sanitizeAmountInput(e.target.value))}
            className={`w-full bg-transparent text-3xl font-black outline-none ${amountInvalid ? "text-rose-400" : ""}`}
          />
          <TokenPicker
            tokens={fromTokens.data?.data ?? []}
            value={fromToken}
            onChange={setFromToken}
          />
        </div>
        {balance !== undefined && fromToken && (
          <button
            type="button"
            className="mt-1 text-xs text-violet-300 hover:text-amber-300"
            onClick={() =>
              setAmountStr(
                formatAmount(balance, fromToken.decimals, fromToken.decimals).replace(/,/g, ""),
              )
            }
          >
            Balance: {formatAmount(balance, fromToken.decimals)} (max)
          </button>
        )}
      </section>

      <div className="relative z-10 -my-3 flex justify-center">
        <button
          type="button"
          onClick={flip}
          aria-label="Flip"
          className="rounded-full border-4 border-violet-950 bg-amber-400 px-3 py-1 font-black text-violet-950 hover:rotate-180 transition"
        >
          ⇅
        </button>
      </div>

      <section className="rounded-2xl bg-violet-900/50 p-3">
        <ChainPicker chains={chainList} value={toChain} onChange={setToChain} label="To" />
        <div className="mt-3 flex items-center gap-2">
          <div className="w-full text-3xl font-black text-violet-200">
            {quote && toToken ? formatAmount(quote.toAmount, toToken.decimals) : "0.0"}
          </div>
          <TokenPicker tokens={toTokens.data?.data ?? []} value={toToken} onChange={setToToken} />
        </div>
      </section>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-violet-300">
        <div className="flex items-center gap-1">
          Slippage
          {SLIPPAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlippage(s)}
              className={`rounded-full px-2 py-0.5 ${s === slippageBps ? "bg-amber-400 font-bold text-violet-950" : "bg-violet-800"}`}
            >
              {s / 100}%
            </button>
          ))}
        </div>
        {!isNative(fromToken) && (
          <div className="flex items-center gap-1">
            Approval
            {(["exact", "permit2"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setApproveMode(m)}
                className={`rounded-full px-2 py-0.5 ${m === approveMode ? "bg-amber-400 font-bold text-violet-950" : "bg-violet-800"}`}
              >
                {m === "exact" ? "Exact" : "Permit2"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        {request === null ? (
          <div
            className="flex items-center justify-center gap-3 py-6 text-sm text-violet-300"
            data-testid="empty-state"
          >
            <Character who={fromCh.key} size={72} mood="idle" />
            <span>
              {fromChain === toChain
                ? `${fromCh.name} is ready to swap.`
                : `${fromCh.name} → ${characterForChain(toChain).name}: cross-chain!`}
              <br />
              Type an amount and Swap-chan will find the best route.
            </span>
          </div>
        ) : quotes.isLoading ? (
          <RoutesLoading from={fromChain} to={toChain} />
        ) : quotes.isError ? (
          <SpeechBubble who="swapchan">
            Uwaa, the quote service said: {(quotes.error as Error).message}
          </SpeechBubble>
        ) : qres && qres.quotes.length === 0 ? (
          <div className="flex flex-col items-center py-4 text-sm text-violet-300">
            <Character who="swapchan" size={90} mood="sad" />
            No routes found for this pair. Try another token or amount.
          </div>
        ) : qres && toToken ? (
          <RouteList
            quotes={qres.quotes}
            best={qres.best}
            selected={selected}
            onSelect={setSelected}
            toToken={toToken}
            errors={qres.errors}
          />
        ) : null}
      </div>

      {phase.k === "error" && (
        <div className="mt-3">
          <SpeechBubble who="swapchan">
            <span className="text-rose-300">Gomen! {phase.msg}</span>{" "}
            <button type="button" className="underline" onClick={() => setPhase({ k: "idle" })}>
              dismiss
            </button>
          </SpeechBubble>
        </div>
      )}

      <button
        type="button"
        disabled={!cta.action || busy}
        onClick={cta.action}
        className="mt-4 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-fuchsia-500 py-4 text-lg font-black text-violet-950 shadow-[0_0_30px_rgba(245,183,0,.35)] transition enabled:hover:scale-[1.01] disabled:opacity-40"
      >
        {cta.label}
      </button>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-lg rounded-3xl border-2 border-violet-500/40 bg-violet-950/80 p-4 shadow-[0_0_80px_rgba(168,85,247,.25)] backdrop-blur">
      {children}
    </div>
  );
}
