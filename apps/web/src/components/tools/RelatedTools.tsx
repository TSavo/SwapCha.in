import Link from "next/link";
import { RELATED_FOR, relatedTools } from "@/lib/devTools";

/** Links from a result page to the free /tools pages that help with the same addresses. */
export function RelatedTools({ ctx }: { ctx: keyof typeof RELATED_FOR }) {
  return (
    <nav aria-label="Related tools" data-testid="related-tools" className="text-sm text-violet-300">
      <span className="font-bold">Related tools: </span>
      {relatedTools(ctx).map((t, i) => (
        <span key={t.href}>
          {i > 0 && " · "}
          <Link href={t.href} className="underline hover:text-amber-300">
            {t.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}
