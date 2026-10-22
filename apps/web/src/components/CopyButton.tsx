"use client";

import { useState } from "react";
import { track } from "@/lib/ga";

export function CopyButton({
  text,
  client,
  label = "Copy",
}: {
  text: string;
  client: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        track("mcp_config_copied", { client });
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-400"
    >
      {done ? "Copied~ ✓" : label}
    </button>
  );
}

export function InstallLink({
  href,
  client,
  children,
}: {
  href: string;
  client: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={() => track("mcp_config_copied", { client, method: "deeplink" })}
      className="rounded-full bg-amber-300 px-5 py-3 text-sm font-black text-violet-950 shadow-lg hover:bg-amber-200"
    >
      {children}
    </a>
  );
}
