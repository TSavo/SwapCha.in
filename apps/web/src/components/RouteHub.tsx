import Link from "next/link";
import { chainName, routeHref, type SeoRoute, title } from "@/lib/routes";

/** Routes grouped by origin chain. */
export function RouteHub({ routes }: { routes: SeoRoute[] }) {
  const groups = new Map<number, SeoRoute[]>();
  for (const r of routes) groups.set(r.fromChainId, [...(groups.get(r.fromChainId) ?? []), r]);
  return (
    <div className="w-full">
      {[...groups].map(([id, rs]) => (
        <section key={id} className="mb-6">
          <h2 className="mb-2 text-xl font-black">From {chainName(id)}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rs.map((r) => (
              <li key={r.slug}>
                <Link
                  href={routeHref(r)}
                  className="block rounded-xl border-2 border-violet-700 bg-violet-950 px-3 py-2 text-sm font-bold hover:border-amber-300"
                >
                  {title(r).replace("Cheapest way to ", "")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
