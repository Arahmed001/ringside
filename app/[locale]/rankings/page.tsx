import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { DIVISIONS, slugifyDivision, limitLabel } from "@/lib/divisions";
import { rankDivision, pound4pound, rankingDepth } from "@/lib/rankings";
import { Headshot } from "@/components/Portrait";
import { BoxerCard, SectionTitle } from "@/components/ui";
import { recordStr } from "@/lib/world";
import type { Sex } from "@/lib/types";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({ path: "/rankings", title: t("Rankings"), description: t("Current boxing rankings for every weight class and pound for pound, rated by an Elo-style system and updated after every fight.") }));

export default async function Rankings({ searchParams }: { searchParams: Promise<{ sex?: string }> }) {
  const t = await getT();
  const sex: Sex = (await searchParams).sex === "female" ? "female" : "male";
  const w = await getWorld();
  const p4p = pound4pound(w, 10, sex);
  const thin = rankingDepth(w).partialShare > 0.5;
  const divisions = DIVISIONS.map((d) => ({ d, top: rankDivision(w, d.name, 5, sex) })).filter((x) => sex === "male" || x.top.length > 0);
  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Updated after every fight")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{sex === "female" ? t("Women’s rankings") : t("Current rankings")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Every division ranked by Elo-style rating. Active fighters with five or more bouts, a winning record and a fight in the last 24 months qualify. Arrows show movement over the last 90 days.")}</p>
        {thin && <p className="mt-3 max-w-2xl text-sm text-gold">{t("These rankings count only the fights Ringside holds. Most fighters here have only their most recent fights on record so far, so few reach the five fights a ranking needs; more qualify as the history is added.")}</p>}
        <div className="mt-4 flex gap-2">
          <Link href="/rankings" className={`chip ${sex === "male" ? "!border-gold/50 !text-gold" : ""}`}>{t("Men")}</Link>
          <Link href="/rankings?sex=female" className={`chip ${sex === "female" ? "!border-gold/50 !text-gold" : ""}`}>{t("Women")}</Link>
        </div>
      </div>
      <section>
        <SectionTitle eyebrow={t("Across all weights")} title={t("Pound for pound")} />
        {p4p.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{p4p.map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}</div> : <p className="text-sm text-muted">{t("Not enough qualifying fighters yet.")}</p>}
      </section>
      <section>
        <SectionTitle eyebrow={t.n(divisions.length, "{n} division", "{n} divisions")} title={t("By weight class")} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {divisions.map(({ d, top }) => (
            <Link key={d.name} href={`/rankings/${slugifyDivision(d.name)}${sex === "female" ? "?sex=female" : ""}`} className="card card-hover block p-4">
              <div className="mb-3 flex items-baseline justify-between"><div className="font-display text-2xl font-bold uppercase">{t(d.name)}</div><div className="text-xs text-muted">{limitLabel(d, t)}</div></div>
              <ol className="space-y-2">
                {top.map((r) => (
                  <li key={r.boxer.id} className="flex items-center gap-2.5 text-sm">
                    <span className={`w-5 text-center font-display text-lg font-bold ${r.rank === 1 ? "text-gold" : "text-muted"}`}>{r.rank === 1 ? t("C") : r.rank}</span>
                    <Headshot boxer={r.boxer} size={26} rounded={false} className="rounded-full object-cover" />
                    <span className="min-w-0 flex-1 truncate">{t.name(r.boxer.name)}</span>
                    <span className="tabular text-xs text-muted">{recordStr(r.boxer)}</span>
                  </li>
                ))}
                {!top.length && <li className="text-sm text-muted">{t("Not enough qualifying fighters.")}</li>}
              </ol>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("“C” marks the top-rated fighter in the division, not an official sanctioning-body champion.")}</p>
      </section>
    </div>
  );
}
