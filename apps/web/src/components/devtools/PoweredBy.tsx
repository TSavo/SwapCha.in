import { BLOCKTOOLS_URL, POWERED_BY } from "@/lib/devTools";

/** "Powered by blocktools" footer for tool pages that just call a blocktools function. */
export function PoweredBy() {
  return (
    <a
      href={BLOCKTOOLS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-amber-300"
    >
      {POWERED_BY}
    </a>
  );
}
