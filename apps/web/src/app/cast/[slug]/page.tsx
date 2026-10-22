import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BIOS, castHref, castOrder, fullArtSrc, ogSrc } from "@/lib/bios";
import { CHARACTERS, type CharacterKey, characterSrc } from "@/lib/characters";

type Props = { params: Promise<{ slug: string }> };

const isKey = (s: string): s is CharacterKey => s in BIOS;

export const dynamicParams = false;
export function generateStaticParams() {
  return castOrder.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isKey(slug)) return {};
  const c = CHARACTERS[slug];
  const b = BIOS[slug];
  const title = `${c.name}: ${b.role} · SwapChan`;
  return {
    title,
    description: b.intro,
    openGraph: {
      title,
      description: b.intro,
      images: [{ url: ogSrc(slug), width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description: b.intro, images: [ogSrc(slug)] },
  };
}

function Section({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-3xl border-2 bg-violet-950/70 p-5"
      style={{ borderColor: `${color}55` }}
    >
      <h2 className="mb-2 text-sm font-black tracking-wider uppercase" style={{ color }}>
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-violet-100">{children}</div>
    </section>
  );
}

export default async function CharacterPage({ params }: Props) {
  const { slug } = await params;
  if (!isKey(slug)) notFound();
  const c = CHARACTERS[slug];
  const b = BIOS[slug];
  const i = castOrder.indexOf(slug);
  const prev = castOrder[(i - 1 + castOrder.length) % castOrder.length] as CharacterKey;
  const next = castOrder[(i + 1) % castOrder.length] as CharacterKey;
  const facts: [string, string][] = [
    ["Chain", b.facts.chain],
    ["Launched", b.facts.launched],
    ["Consensus", b.facts.consensus],
    ["Native token", b.facts.token],
    ["Known for", b.facts.knownFor],
  ];
  return (
    <article className="w-full" data-testid="cast-page">
      <nav className="mb-4 flex justify-between text-sm font-bold text-violet-300">
        <Link href="/cast" className="hover:text-amber-300">
          ← The Cast
        </Link>
        <span className="flex gap-4">
          <Link href={castHref(prev)} className="hover:text-amber-300">
            ‹ {CHARACTERS[prev].name}
          </Link>
          <Link href={castHref(next)} className="hover:text-amber-300">
            {CHARACTERS[next].name} ›
          </Link>
        </span>
      </nav>
      <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="relative flex flex-col items-center">
          <div
            className="absolute inset-x-6 top-10 bottom-10 rounded-full blur-3xl"
            style={{ background: `${c.color}33` }}
            aria-hidden
          />
          <a
            href={fullArtSrc(slug)}
            target="_blank"
            rel="noreferrer"
            className="relative"
            title="Open full-size art"
          >
            <img
              src={fullArtSrc(slug)}
              alt={`${c.name}, full-size art`}
              width={704}
              height={1088}
              className="animate-float h-auto max-h-[78vh] w-full object-contain drop-shadow-[0_0_24px_var(--glow)]"
              style={{ ["--glow" as string]: `${c.color}99` }}
            />
          </a>
          {b.art === "coming-soon" && (
            <p
              className="relative mt-2 rounded-full bg-violet-800 px-3 py-1 text-xs font-bold"
              data-testid="art-coming-soon"
            >
              🎨 Art coming soon: this is a recolored stand-in
            </p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <header>
            <h1 className="text-5xl font-black" style={{ color: c.color }}>
              {c.name}
            </h1>
            <p className="mt-1 text-lg font-bold text-violet-200">{b.role}</p>
            <blockquote className="mt-3 rounded-2xl rounded-bl-none border-2 border-amber-400/50 bg-violet-950/90 px-4 py-2 text-lg font-bold text-amber-200">
              “{b.catchphrase}”
            </blockquote>
            <p className="mt-3 text-violet-100">{b.intro}</p>
          </header>
          <Section title="Chain facts" color={c.color}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-bold text-violet-300">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Personality" color={c.color}>
            {b.personality}
          </Section>
          <Section title="Look" color={c.color}>
            {b.look}
          </Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Likes" color={c.color}>
              <ul className="list-inside list-disc">
                {b.likes.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
            <Section title="Dislikes" color={c.color}>
              <ul className="list-inside list-disc">
                {b.dislikes.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
          </div>
          <Section title="Relationships" color={c.color}>
            <p className="mb-3">
              <b>With Swap-chan:</b> {b.withSwapchan}
            </p>
            <ul className="flex flex-col gap-2">
              {b.friends.map((f) => (
                <li key={f.who}>
                  <Link
                    href={castHref(f.who)}
                    className="flex items-center gap-2 hover:text-amber-300"
                  >
                    <img src={characterSrc(f.who)} alt="" width={40} height={40} />
                    <span>
                      <b style={{ color: CHARACTERS[f.who].color }}>{CHARACTERS[f.who].name}</b>:{" "}
                      {f.note}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          {c.chainId !== null && (
            <Link
              href="/"
              className="self-start rounded-full bg-amber-400 px-5 py-2 font-black text-violet-950 hover:bg-amber-300"
            >
              Swap on {b.facts.chain.replace(/ \(.*\)$/, "")} with Swap-chan →
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
