import type { LegalDoc } from "@/lib/legal";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <article className="mx-auto mt-4 max-w-3xl text-violet-100">
      <h1 className="mb-2 text-4xl font-black text-amber-300">{doc.title}</h1>
      <p className="mb-6 text-xs text-violet-300">Last updated: {doc.updated}</p>
      <p className="mb-6">{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.h} className="mb-6">
          <h2 className="mb-2 text-xl font-bold text-amber-200">{s.h}</h2>
          {s.p.map((t) => (
            <p key={t} className="mb-2 break-words">
              {t}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
