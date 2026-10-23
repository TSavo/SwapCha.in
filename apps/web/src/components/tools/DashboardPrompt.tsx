"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useSolana } from "@/lib/useSolana";

/** After a wallet connects, offer the dashboard once per session. */
export function DashboardPrompt() {
  const { address } = useAccount();
  const sol = useSolana();
  const path = usePathname();
  const [show, setShow] = useState(false);
  const who = address ?? sol.address;
  useEffect(() => {
    if (who && !path.startsWith("/dashboard") && !sessionStorage.getItem("sc_dash_prompt"))
      setShow(true);
  }, [who, path]);
  if (!show) return null;
  const close = () => {
    sessionStorage.setItem("sc_dash_prompt", "1");
    setShow(false);
  };
  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-violet-950 px-4 py-3 shadow-2xl"
      data-testid="dashboard-prompt"
    >
      <Link href="/dashboard" onClick={close} className="font-black text-amber-300 hover:underline">
        💰 View your dashboard: we'll look for money you forgot
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={close}
        className="text-violet-300 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
