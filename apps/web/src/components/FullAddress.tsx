"use client";

import { useState } from "react";
import { displayAddress } from "@/lib/address";

/** Copy-to-clipboard button for a full address (copies the checksummed form). */
export function CopyButton({ value }: { value: string }) {
  const full = displayAddress(value);
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cursor-pointer rounded border border-violet-400 px-1 text-[10px] font-sans text-violet-200 hover:border-amber-300"
      aria-label={`Copy address ${full}`}
      title="Copy full address"
      onClick={() => {
        navigator.clipboard?.writeText(full).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/** A full (never shortened) address, EIP-55 for EVM, with a copy-to-clipboard button. */
export function FullAddress({ address, testId }: { address: string; testId?: string }) {
  return (
    <span className="inline break-all font-mono">
      <span data-testid={testId}>{displayAddress(address)}</span> <CopyButton value={address} />
    </span>
  );
}
