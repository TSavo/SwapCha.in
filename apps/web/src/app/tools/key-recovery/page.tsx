import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Key derivation & wallet recovery: why it is not on this site | SwapChan",
  description:
    "SwapChan never asks for private keys, seed phrases or wallet passwords. Key derivation and wallet-file recovery run offline in blocktools, not in a web page.",
  alternates: { canonical: "/tools/key-recovery" },
};

/** Static info page: key derivation and recovery deliberately have NO working tool on SwapChan. */
export default function KeyRecoveryInfo() {
  return (
    <article className="w-full max-w-3xl">
      <h1 className="text-2xl font-black md:text-3xl">Key derivation and wallet recovery</h1>
      <p className="mb-4 text-sm text-violet-200 md:text-base">
        There is no key derivation or recovery tool on this site, on purpose. SwapChan never asks
        for, receives, holds or derives private keys, seed phrases or wallet passwords, and never
        signs anything.
      </p>
      <section className="space-y-3 text-violet-100">
        <p>
          Deriving keys from a seed phrase, decrypting an old wallet file (wallet.dat, keystore
          JSON, Electrum, MultiBit, Armory) or repairing a seed phrase with typos all touch secrets.
          That work belongs offline, on your own machine, in blocktools, never in a web page or an
          AI chat.
        </p>
        <p>
          What you can do here with public data only: list the addresses of an extended public key
          with the{" "}
          <Link href="/tools/xpub-addresses" className="underline hover:text-amber-300">
            xpub address tool
          </Link>
          , check an address with the{" "}
          <Link href="/tools/validate-address" className="underline hover:text-amber-300">
            address validator
          </Link>
          , and see what an address holds with{" "}
          <Link href="/find-money" className="underline hover:text-amber-300">
            Find money
          </Link>
          .
        </p>
        <p className="rounded-xl border border-amber-400 bg-amber-400/10 p-3 text-sm font-bold text-amber-200">
          Never paste a private key, seed phrase or wallet password into any website, including this
          one. Anyone offering to recover your wallet online is a scam risk.
        </p>
      </section>
    </article>
  );
}
