import Link from "next/link";
import { POWERED_BY } from "@/lib/devTools";

/** "Powered by blocktools" credit; links to the blocktools home on SwapChan. */
export function PoweredBy() {
  return (
    <Link href="/blocktools" className="underline hover:text-amber-300">
      {POWERED_BY}
    </Link>
  );
}
