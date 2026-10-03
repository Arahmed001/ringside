import { headers } from "next/headers";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { askData, MAX_QUESTION } from "@/lib/ask";
import { hasKey } from "@/lib/ai";
import { clientId } from "@/lib/ai-guard";
import { exampleQuestions } from "@/lib/ask/examples";
import { AskResults } from "@/components/AskResults";
import { getNames } from "@/lib/i18n/names";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = async ({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }> }) => {
  const meta = await metaFor(params, (p, t) => ({
    path: "/ask", title: t("Ask the data"),
    description: t("Ask a question about fighters, fights, titles, records, upcoming cards or fight money in plain English or Arabic, and get an answer worked out from the database, with the tables it came from."),
  }));
  // an answer to one person's question is not a page worth indexing
  return (await searchParams).q ? { ...meta, robots: { index: false, follow: false } } : meta;
};

export default async function Ask({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const t = await getT();
  const q = ((await searchParams).q ?? "").slice(0, MAX_QUESTION).trim();
  const w = await getWorld();
  const names = await getNames(t.locale);
  const examples = exampleQuestions(w, t);
  const answer = q ? await askData(q, { w, t, names }, clientId(await headers())) : null;

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Questions and answers")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Ask the data")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Ask about fighters, fights, titles, all-time records, upcoming cards, upsets, trainers or fight money. Answers are worked out from the database and shown with the tables they came from, never from memory.")}</p>
        <form method="get" className="mt-5 flex max-w-3xl gap-3" role="search" aria-label={t("Ask the data")}>
          <label className="sr-only" htmlFor="q">{t("Your question")}</label>
          <input id="q" name="q" defaultValue={q} maxLength={MAX_QUESTION} autoComplete="off" placeholder={t("Try: {example}", { example: examples[0] })} className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-5 py-3.5 text-base outline-none transition placeholder:text-muted focus:border-gold/60" />
          <button className="rounded-2xl bg-red-btn px-6 font-display text-lg font-bold uppercase text-white transition hover:brightness-90">{t("Ask")}</button>
        </form>
        {!hasKey() && <p className="mt-3 max-w-3xl text-xs text-muted">{t("No AI key is set on this site, so answers are put together by rules rather than written by a model. They still come entirely from the data.")}</p>}
      </div>
      {answer ? <AskResults a={answer} /> : null}
      {(!answer || !answer.understood) && (
        <section aria-labelledby="examples">
          <h2 id="examples" className="eyebrow mb-3">{t("Examples")}</h2>
          <ul className="flex flex-wrap gap-2">{examples.map((e) => <li key={e}><Link href={`/ask?q=${encodeURIComponent(e)}`} className="chip hover:!text-ink">{e}</Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
