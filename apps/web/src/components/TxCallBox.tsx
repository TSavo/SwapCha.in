"use client";

import { type TxCall, txCallLines } from "../lib/callSummary";
import { CopyButton } from "./FullAddress";

/** What the claim tx calls: contract (explorer link), function + selector, args in plain words. */
export function TxCallBox({ call }: { call: TxCall }) {
  const [fn, on, ...args] = txCallLines(call);
  return (
    <div
      data-testid="tx-call"
      className="mt-2 rounded-lg bg-violet-900/60 p-2 font-mono text-xs break-all text-violet-200"
    >
      <div>{fn}</div>
      <div>
        {on} <CopyButton value={call.contract} />
        {call.contractExplorerUrl && (
          <>
            {" "}
            <a
              href={call.contractExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              data-testid="tx-call-explorer"
            >
              view on explorer
            </a>
          </>
        )}
      </div>
      {args.length > 0 && (
        <ul className="ml-3 list-disc">
          {args.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
