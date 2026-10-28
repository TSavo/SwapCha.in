import Link from "next/link";
import { BtPage, btMeta, crumbLd, JsonLd } from "@/components/blocktools/BtPage";
import { BT_REPO, renderMd } from "@/lib/blocktools.server";

export const metadata = btMeta(
  "/blocktools/changelog",
  "blocktools changelog",
  "Every notable change to blocktools, by version — new tools, flags and wasm exports, fixes and security notes. SwapChan is the home of blocktools.",
);

export default function Changelog() {
  return (
    <BtPage
      title="Changelog"
      lead={
        <p>
          Every notable change to blocktools, newest version first — new tools, flags and wasm
          exports, fixes and security notes. This mirrors the{" "}
          <a href={`${BT_REPO}/blob/main/CHANGELOG.md`} className="underline hover:text-amber-300">
            CHANGELOG
          </a>{" "}
          in the blocktools repo. For the downloadable binaries of each tagged release, see{" "}
          <Link href="/blocktools/releases" className="underline hover:text-amber-300">
            Releases
          </Link>
          .
        </p>
      }
      source={`${BT_REPO}/blob/main/CHANGELOG.md`}
    >
      <JsonLd
        data={crumbLd([
          ["blocktools", "/blocktools"],
          ["Changelog", "/blocktools/changelog"],
        ])}
      />
      <div className="bt-md" dangerouslySetInnerHTML={{ __html: renderMd("CHANGELOG.md") }} />
    </BtPage>
  );
}
