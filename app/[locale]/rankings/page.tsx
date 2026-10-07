import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { DIVISIONS_HEAVIEST_FIRST, slugifyDivision, limitLabel, divisionLabel } from "@/lib/divisions";
import { rankDivision, pound4pound, rankingDepth } from "@/lib/rankings";
import { Headshot } from "@/components/Portrait";
import { BoxerCard, SectionTitle } from "@/components/ui";
import { recordStr } from "@/lib/world";
import { countryName } from "@/lib/format";
import type { Sex } from "@/lib/types";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { PrintButton } from "@/components/PrintButton";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({ path: "/rankings", title: t("Rankings"), description: t("Current boxing rankings for every weight class and pound for pound, rated by an Elo-style system and updated after every fight.") }));

export default async function Rankings({ searchParams }: { searchParams: Promise<{ sex?: string }> }) {
  const t = await getT();
  const sex: Sex = (await searchParams).sex === "female" ? "female" : "male";
  const w = await getWorld();
  const p4p = pound4pound(w, 10, sex);
  const thin = rankingDepth(w).partialShare > 0.5;
  const divisions = DIVISIONS_HEAVIEST_FIRST.map((d) => ({ d, top: rankDivision(w, d.name, 5, sex) })).filter((x) => sex === "male" || x.top.length > 0);
  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Updated after every fight")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{sex === "female" ? t("Women’s rankings") : t("Current rankings")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Every division ranked by Elo-style rating. Active fighters with five or more bouts, a winning record and a fight in the last 24 months qualify. Arrows show movement over the last 90 days.")}</p>
        {thin && <p className="mt-3 max-w-2xl text-sm text-gold">{t("These rankings count only the fights Ringside holds. Most fighters here have only their most recent fights on record so far, so few reach the five fights a ranking needs; more qualify as the history is added.")}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/rankings" className={`chip ${sex === "male" ? "!border-gold/50 !text-gold" : "no-print"}`}>{t("Men")}</Link>
          <Link href="/rankings?sex=female" className={`chip ${sex === "female" ? "!border-gold/50 !text-gold" : "no-print"}`}>{t("Women")}</Link>
          <span className="ms-auto"><PrintButton /></span>
        </div>
      </div>
      <section>
        <SectionTitle eyebrow={t("Across all weights")} title={t("Pound for pound")} />
        {p4p.length ? <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">{p4p.slice(0, 3).map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} featured />)}</div>
          {p4p.length > 3 && <ol className="card divide-y divide-line/60 px-2 md:columns-2 md:gap-x-6 md:divide-y-0">{p4p.slice(3).map((b, i) => (
            <li key={b.id} className="break-inside-avoid border-line/60 md:border-b">
              <Link href={`/boxers/${b.slug}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-panel-2">
                <span className="w-7 text-center font-display text-xl font-bold text-gold">{i + 4}</span>
                <Headshot boxer={b} size={36} rounded={false} className="rounded-full object-cover" />
                <span className="min-w-0 flex-1"><span className="block break-words font-semibold leading-snug">{t.name(b.name)}</span><span className="block break-words text-xs leading-snug text-muted">{countryName(b.country, t.locale)} · {divisionLabel(b.weightClass, b.sex, t)}</span></span>
                <span className="hidden tabular text-sm font-semibold sm:inline">{recordStr(b)}</span>
                <span className="w-10 text-end tabular text-xs text-gold">{Math.round(b.rating)}</span>
              </Link>
            </li>))}</ol>}
        </div> : <p className="text-sm text-muted">{t("Not enough qualifying fighters yet.")}</p>}
      </section>
      <section>
        <SectionTitle eyebrow={t.n(divisions.length, "{n} division", "{n} divisions")} title={t("By weight class")} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {divisions.map(({ d, top }) => (
            <Link key={d.name} href={`/rankings/${slugifyDivision(d.name)}${sex === "female" ? "?sex=female" : ""}`} className="card card-hover block p-4">
              <div className="mb-3 flex items-baseline justify-between"><div className="font-display text-2xl font-bold uppercase">{t(d.name)}</div><div className="text-xs text-muted">{limitLabel(d, t)}</div></div>
              <ol className="space-y-2">
                {top.map((r) => (
                  <li key={r.boxer.id} className={r.rank === 1 ? "flex items-center gap-2.5 border-b border-line/60 pb-3 text-sm" : "flex items-center gap-2.5 text-sm"}>
                    <span className={`w-5 text-center font-display text-lg font-bold ${r.rank === 1 ? "text-gold" : "text-muted"}`}>{r.rank === 1 ? t("C") : r.rank}</span>
                    <Headshot boxer={r.boxer} size={r.rank === 1 ? 44 : 26} rounded={false} className="rounded-full object-cover" />
                    <span className={`min-w-0 flex-1 break-words leading-snug ${r.rank === 1 ? "font-display text-xl font-bold leading-tight" : ""}`}>{t.name(r.boxer.name)}</span>
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
