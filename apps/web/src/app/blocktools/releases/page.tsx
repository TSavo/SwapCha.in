import Link from "next/link";
import { BtPage, btMeta } from "@/components/blocktools/BtPage";
import { BT_REPO, getReleases, mb } from "@/lib/blocktools.server";

export const revalidate = 3600;
export const metadata = btMeta(
  "/blocktools/releases",
  "blocktools releases and changelog",
  "blocktools releases from GitHub, with dates, notes and downloadable assets. Refreshed hourly.",
);

export default async function Releases() {
  const { releases, live } = await getReleases();
  return (
    <BtPage
      title="Releases"
      lead={
        <p>
          From the GitHub releases API, refreshed hourly. blocktools has no separate changelog file,
          so this list is the changelog.
        </p>
      }
      source={`${BT_REPO}/releases`}
    >
      <ol className="space-y-4">
        {releases.map((r) => (
          <li key={r.tag} className="rounded-xl border border-violet-500/70 bg-violet-900/30 p-4">
            <h2 className="text-xl font-black">
              <a href={r.url} className="hover:text-amber-300">
                {r.name || r.tag}
              </a>
            </h2>
            <p className="text-xs text-violet-400">
              {new Date(r.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </p>
            <p className="mt-2 whitespace-pre-line text-sm">{r.body}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {r.assets.map((a) => (
                <li key={a.name}>
                  <a href={a.url} className="font-mono text-amber-300 underline">
                    {a.name}
                  </a>{" "}
                  ({mb(a.size)})
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {!live && (
        <p className="mt-3 text-xs text-violet-400">
          GitHub was unreachable at build time; showing the last known list.
        </p>
      )}
      <p className="mt-6">
        <Link href="/blocktools/install" className="underline">
          Install guide
        </Link>{" "}
        ·{" "}
        <Link href="/blocktools/binaries" className="underline">
          Platforms
        </Link>
      </p>
    </BtPage>
  );
}
