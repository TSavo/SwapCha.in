"use client";

import {
  COW_NETWORK,
  COW_VAULT_RELAYER,
  NATIVE_TOKEN,
  SUPPORTED_CHAINS,
  type Token,
} from "@swapchan/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { erc20Abi } from "viem";
import {
  useAccount,
  useConfig,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { formatAmount, parseAmount, sanitizeAmountInput } from "@/lib/amount";
import { api } from "@/lib/api";
import { track } from "@/lib/ga";
import { buyForPrice, type LimitOrder, limitApi, priceOf } from "@/lib/limit";
import { AmountField } from "./AmountField";
import { ConnectButton } from "./ConnectButton";
import { ChainPicker, TokenPicker } from "./Pickers";

const CHAINS = Object.keys(COW_NETWORK)
  .map(Number)
  .map((id) => ({ id, ...SUPPORTED_CHAINS[id as keyof typeof SUPPORTED_CHAINS] }));
const EXPIRY = [
  ["1 hour", 3600],
  ["1 day", 86_400],
  ["7 days", 7 * 86_400],
  ["30 days", 30 * 86_400],
  ["90 days", 90 * 86_400],
] as const;
const isNative = (t: Token) => t.address.toLowerCase() === NATIVE_TOKEN.toLowerCase();

export function LimitCard() {
  const config = useConfig();
  const qc = useQueryClient();
  const { address, chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [chainId, setChainId] = useState(8453);
  const [sell, setSell] = useState<Token>();
  const [buy, setBuy] = useState<Token>();
  const [amountStr, setAmount] = useState("100");
  const [priceStr, setPrice] = useState("");
  const [expiry, setExpiry] = useState<number>(7 * 86_400);
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; href?: string }>();

  const tokens = useQuery({ queryKey: ["tokens", chainId], queryFn: () => api.tokens(chainId) });
  const list = tokens.data?.data ?? [];
  useEffect(() => {
    if (!list.length) return;
    if (!sell || sell.chainId !== chainId)
      setSell(list.find((t) => t.symbol === "USDC") ?? list.find((t) => !isNative(t)));
    if (!buy || buy.chainId !== chainId)
      setBuy(
        list.find(
          (t) => t.symbol.startsWith("WETH") || t.symbol === "WBNB" || t.symbol === "WAVAX",
        ) ?? list[0],
      );
  }, [list, chainId, sell, buy]);

  const sellAmount = sell ? parseAmount(amountStr, sell.decimals) : null;
  const market = useQuery({
    queryKey: ["limit-market", chainId, sell?.address, buy?.address, sellAmount?.toString()],
    queryFn: () =>
      limitApi.market({
        chainId,
        sellToken: sell!.address,
        buyToken: buy!.address,
        sellAmount: sellAmount!.toString(),
      }),
    enabled: !!sell && !!buy && !!sellAmount && sellAmount > 0n && sell.address !== buy.address,
    refetchInterval: 30_000,
  });
  const marketPrice =
    market.data && sell && buy && sellAmount
      ? priceOf(sellAmount, sell.decimals, BigInt(market.data.buyAmount), buy.decimals)
      : null;
  useEffect(() => {
    if (marketPrice && !priceStr) setPrice(marketPrice);
  }, [marketPrice, priceStr]);
  const buyAmount =
    sell && buy && sellAmount
      ? buyForPrice(sellAmount, sell.decimals, buy.decimals, priceStr)
      : null;
  const vsMarket =
    marketPrice && Number(priceStr) > 0 ? (Number(priceStr) / Number(marketPrice) - 1) * 100 : null;

  const allowance = useReadContract({
    address: sell?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address as `0x${string}`, COW_VAULT_RELAYER],
    chainId,
    query: { enabled: !!address && !!sell },
  });
  const orders = useQuery({
    queryKey: ["limit-orders", chainId, address],
    queryFn: () => limitApi.orders(chainId, address!),
    enabled: !!address,
    refetchInterval: 20_000,
  });
  const symbolOf = (a: string) => list.find((t) => t.address.toLowerCase() === a.toLowerCase());

  const ensureChain = async () => {
    if (walletChain !== chainId) await switchChainAsync({ chainId });
  };
  async function place() {
    if (!address || !sell || !buy || !sellAmount || !buyAmount) return;
    setMsg(undefined);
    try {
      await ensureChain();
      if ((allowance.data ?? 0n) < sellAmount) {
        setBusy("Approving…");
        const h = await writeContractAsync({
          address: sell.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [COW_VAULT_RELAYER, sellAmount],
          chainId,
        });
        await waitForTransactionReceipt(config, { hash: h, chainId });
        await allowance.refetch();
      }
      setBusy("Sign the order…");
      const built = await limitApi.build({
        chainId,
        owner: address,
        sellToken: sell.address,
        buyToken: buy.address,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        validTo: Math.floor(Date.now() / 1000) + expiry,
      });
      const o = built.order;
      const signature = await signTypedDataAsync({
        domain: o.domain,
        types: o.types,
        primaryType: o.primaryType,
        message: o.message,
      } as Parameters<typeof signTypedDataAsync>[0]);
      setBusy("Posting to CoW…");
      const r = await limitApi.submit({ chainId, owner: address, order: o.message, signature });
      track("limit_order_placed", {
        chain: chainId,
        sell: sell.symbol,
        buy: buy.symbol,
        vs_market_pct: vsMarket ?? 0,
      });
      setMsg({
        ok: true,
        text: "Limit order placed! Solvers fill it when the price hits~",
        href: r.explorer,
      });
      void qc.invalidateQueries({ queryKey: ["limit-orders"] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.split("\n")[0] ?? "failed" });
    } finally {
      setBusy(undefined);
    }
  }
  async function cancel(o: LimitOrder) {
    try {
      await ensureChain();
      const td = await limitApi.cancelData(chainId, o.uid);
      const signature = await signTypedDataAsync(td as Parameters<typeof signTypedDataAsync>[0]);
      await limitApi.cancel({ chainId, orderUids: [o.uid], signature });
      track("limit_order_cancelled", { chain: chainId });
      void qc.invalidateQueries({ queryKey: ["limit-orders"] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.split("\n")[0] ?? "cancel failed" });
    }
  }

  const invalid = !sellAmount || sellAmount === 0n || !buyAmount || buyAmount === 0n;
  return (
    <div data-testid="limit-card">
      <section className="rounded-2xl border-2 border-violet-700 bg-violet-900 p-3">
        <ChainPicker chains={CHAINS} value={chainId} onChange={setChainId} label="Limit order" />
        <AmountField
          label="You pay"
          ariaLabel="Sell amount"
          value={amountStr}
          onChange={(v) => setAmount(sanitizeAmountInput(v))}
          right={
            <TokenPicker
              tokens={list}
              value={sell}
              onChange={setSell}
              chainId={chainId}
              exclude={isNative}
            />
          }
        />
      </section>
      <section className="mt-2 rounded-2xl border-2 border-violet-700 bg-violet-900 p-3">
        <div className="flex items-center justify-between text-xs font-bold tracking-wider text-violet-200 uppercase">
          <span>
            Limit price ({buy?.symbol ?? "?"} per {sell?.symbol ?? "?"})
          </span>
          {marketPrice && (
            <button
              type="button"
              onClick={() => setPrice(marketPrice)}
              className="cursor-pointer rounded-full border-2 border-violet-500 px-2 py-0.5 normal-case hover:border-amber-300"
            >
              Market: {marketPrice}
            </button>
          )}
        </div>
        <AmountField
          label="Price"
          ariaLabel="Limit price"
          size="md"
          value={priceStr}
          onChange={(v) => setPrice(sanitizeAmountInput(v))}
          right={<TokenPicker tokens={list} value={buy} onChange={setBuy} chainId={chainId} />}
        />
        <div className="mt-1 flex gap-1.5">
          {[0, 1, 2, 5, 10].map((p) => (
            <button
              key={p}
              type="button"
              disabled={!marketPrice}
              onClick={() =>
                marketPrice &&
                setPrice(String(+(Number(marketPrice) * (1 + p / 100)).toPrecision(6)))
              }
              className="cursor-pointer rounded-lg border-2 border-violet-600 px-2 py-0.5 text-xs font-bold hover:border-amber-300"
            >
              {p === 0 ? "Market" : `+${p}%`}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-violet-100">
          You receive at least{" "}
          <b>
            {buyAmount && buy ? formatAmount(buyAmount, buy.decimals) : "—"} {buy?.symbol}
          </b>
          {vsMarket !== null && (
            <span className={vsMarket >= 0 ? " text-emerald-300" : " text-rose-300"}>
              {" "}
              ({vsMarket >= 0 ? "+" : ""}
              {vsMarket.toFixed(2)}% vs market)
            </span>
          )}
        </p>
      </section>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <label htmlFor="expiry" className="font-bold text-violet-200">
          Expires in
        </label>
        <select
          id="expiry"
          value={expiry}
          onChange={(e) => setExpiry(Number(e.target.value))}
          className="cursor-pointer rounded-lg border-2 border-violet-500 bg-violet-900 px-2 py-1 font-bold"
        >
          {EXPIRY.map(([l, s]) => (
            <option key={s} value={s}>
              {l}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-violet-300">Gasless · via CoW Protocol</span>
      </div>
      <div className="mt-3">
        {!address ? (
          <ConnectButton />
        ) : (
          <button
            type="button"
            disabled={invalid || !!busy}
            onClick={place}
            className="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-amber-400 to-fuchsia-500 py-3 text-lg font-black text-violet-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ?? "Place limit order"}
          </button>
        )}
      </div>
      {msg && (
        <p
          className={`mt-2 text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}
          role="status"
        >
          {msg.text}{" "}
          {msg.href && (
            <a href={msg.href} target="_blank" rel="noreferrer" className="underline">
              View on CoW Explorer
            </a>
          )}
        </p>
      )}
      {address && (
        <section className="mt-4" data-testid="open-orders">
          <h3 className="mb-2 text-sm font-black tracking-wider text-violet-200 uppercase">
            Your limit orders
          </h3>
          {orders.isLoading && <p className="text-sm text-violet-300">Loading…</p>}
          {orders.data?.length === 0 && (
            <p className="text-sm text-violet-300">No limit orders on this chain yet.</p>
          )}
          <ul className="flex flex-col gap-2">
            {orders.data?.map((o) => {
              const s = symbolOf(o.sellToken);
              const b = symbolOf(o.buyToken);
              return (
                <li
                  key={o.uid}
                  className="flex items-center gap-2 rounded-xl border-2 border-violet-700 bg-violet-900 p-2 text-sm"
                >
                  <span className="flex-1">
                    <b>
                      {s ? formatAmount(o.sellAmount, s.decimals) : o.sellAmount} {s?.symbol ?? "?"}{" "}
                      → ≥{b ? formatAmount(o.buyAmount, b.decimals) : o.buyAmount}{" "}
                      {b?.symbol ?? "?"}
                    </b>
                    <span className="block text-xs text-violet-300">
                      {o.status} · expires {new Date(o.validTo * 1000).toLocaleString()} ·{" "}
                      <a href={o.explorer} target="_blank" rel="noreferrer" className="underline">
                        explorer
                      </a>
                    </span>
                  </span>
                  {o.status === "open" && (
                    <button
                      type="button"
                      onClick={() => cancel(o)}
                      className="cursor-pointer rounded-lg border-2 border-rose-400 px-2 py-1 font-bold text-rose-200 hover:bg-rose-500/20"
                    >
                      Cancel
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
