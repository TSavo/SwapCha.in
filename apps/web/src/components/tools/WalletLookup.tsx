"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { useSolana } from "@/lib/useSolana";
import { walletTarget } from "@/lib/walletLookup";
import { LookupForm } from "./LookupForm";

/**
 * Address lookup linked to the connected wallet (read-only: no signature). Connected on the landing
 * page -> straight to your wallet's result; viewing another address -> a "check my wallet" link;
 * not connected -> a Connect wallet button. Typing an address always works as a fallback.
 */
export function WalletLookup({
  base,
  label,
  placeholder,
  current,
}: {
  base: string;
  label: string;
  placeholder: string;
  current?: string;
}) {
  const { address } = useAccount();
  const sol = useSolana();
  const connected = address ?? sol.address;
  const router = useRouter();
  const { auto, offer } = walletTarget(base, connected, current);
  const went = useRef(false);
  useEffect(() => {
    if (auto && !went.current) {
      went.current = true;
      router.replace(auto);
    }
  }, [auto, router]);
  return (
    <div className="flex w-full flex-col gap-3" data-testid="wallet-lookup">
      {connected ? (
        offer && (
          <Link
            href={offer}
            className="block rounded-xl border-2 border-violet-950 bg-amber-400 px-5 py-3 text-center font-black text-violet-950 shadow-[0_3px_0_#2e1065] hover:bg-amber-300"
          >
            Check my connected wallet →
          </Link>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <ConnectButton />
          <span className="text-sm text-violet-300">
            to check your own wallet, or type any address below.
          </span>
        </div>
      )}
      <LookupForm
        key={current ?? connected ?? ""}
        base={base}
        label={label}
        placeholder={placeholder}
        initial={current ?? connected ?? ""}
      />
    </div>
  );
}
