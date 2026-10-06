import { CountUp } from "@/components/CountUp";
import Link from "@/components/L";
import { notFound } from "next/navigation";
import { getWorld, koView, recordStr } from "@/lib/world";
import { DIVISIONS_HEAVIEST_FIRST, divisionFromSlug, divisionLabel, limitLabel, slugifyDivision } from "@/lib/divisions";
import { rankDivision, rankedBoxers, rankRow, rankingDepth } from "@/lib/rankings";
import { pageRanked, ranked } from "@/lib/people-list";
import { ListFinder } from "@/components/ListFinder";
import { getNames } from "@/lib/i18n/names";
import { archetype } from "@/lib/style";
import { Headshot } from "@/components/Portrait";
import { Delta, ArchBadge, Pager } from "@/components/ui";
import { SortTh } from "@/components/SortTh";
import { parseSort, sortQuery, sortRanked, type Sort } from "@/lib/table-sort";
import { careerView } from "@/lib/career";
import type { BoxerFull } from "@/lib/types";
import { countryName, flag, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { OfficialListView } from "@/components/OfficialList";
import { officialKey } from "@/lib/official";
import { RANKING_BODIES } from "@/lib/providers";
import { metaFor, pagedTitle, type SearchParams } from "@/lib/seo-server";
import { BreadcrumbLd } from "@/components/JsonLd";

export const generateMetadata = ({ params, searchParams }: { params: Promise<{ locale: string; division: string }>; searchParams: Promise<SearchParams> }) => metaFor(params, async (p, t, sp) => {
  const d = divisionFromSlug(p.division);
  if (!d) notFound();
  const champ = rankDivision(await getWorld(), d.name, 1, "male")[0];
  return {
    path: `/rankings/${p.division}`,
    title: pagedTitle(t, t("{division} rankings", { division: t(d.name) }), sp.page),
    description: champ
      ? t("Current {division} boxing rankings by Elo rating, with record, style, KO rate and recent form. {name} ({record}) is the top-rated fighter.", { division: t(d.name), name: t.name(champ.boxer.name), record: recordStr(champ.boxer) })
      : t("Current {division} boxing rankings by Elo rating, with record, style, KO rate and recent form for every qualifying fighter.", { division: t(d.name) }),
  };
}, searchParams);

/** Fighters per page of a division's ranking. */
const RANK_PAGE = 25;

/** The columns a division table can be sorted by, and what each is sorted on. The default is the ranking itself. */
const SORT_COLUMNS = { rank: { textual: true }, name: { textual: true }, record: { textual: false }, ko: { textual: false }, last: { textual: false }, rating: { textual: false } };
const DEFAULT_SORT: Sort<keyof typeof SORT_COLUMNS> = { key: "rank", dir: "asc" };
const SORT_VALUE: Record<keyof typeof SORT_COLUMNS, (b: BoxerFull) => number | string | null> = {
  rank: () => null, name: (b) => b.name, record: (b) => careerView(b).wins, ko: (b) => koView(b).rate, last: (b) => b.lastFight ?? null, rating: (b) => b.rating,
};

export default async function DivisionRankings({ params, searchParams }: { params: Promise<{ locale: string; division: string }>; searchParams: Promise<{ sex?: string; q?: string; page?: string; list?: string; sort?: string; dir?: string }> }) {
  const t = await getT();
  const { division } = await params;
  const sp = await searchParams;
  const sex = sp.sex === "female" ? "female" : "male";
  const sexQ = sex === "female" ? "?sex=female" : "";
  const typed = (sp.q ?? "").slice(0, 80);
  const d = divisionFromSlug(division);
  if (!d) notFound();
  const w = await getWorld();
  // the sanctioning bodies' official lists for this division (men's only: the supplier has no women's lists), chosen by ?list=wbc; anything else is our own ranking
  const lists = sex === "male" ? w.official.byDivision.get(officialKey("male", d.name)) ?? [] : [];
  const official = lists.find((l) => l.body.toLowerCase() === (sp.list ?? "").toLowerCase());
  const names = await getNames(t.locale);
  // every ranked fighter is reachable: a name filter and pages of 25, each fighter keeping the place held in the whole division
  // a column can be chosen to sort by (?sort=ko&dir=desc): the whole division is put in that order first, each fighter keeping the place held in the division
  const sort = parseSort(sp, SORT_COLUMNS, DEFAULT_SORT);
  const pg = pageRanked(sortRanked(ranked(rankedBoxers(w, d.name, sex)), sort, SORT_VALUE[sort.key]), (b) => b.name, { q: typed, page: sp.page, names, size: RANK_PAGE });
  const keepQ = { ...(sex === "female" ? { sex } : {}), ...(typed ? { q: typed } : {}) };
  const sortQ = sortQuery(sort, DEFAULT_SORT);
  const rows = pg.shown.map(({ row, rank }) => rankRow(w, d.name, sex, row, rank));
  const champ = rankDivision(w, d.name, 1, sex)[0];
  const th = { current: sort, fallback: DEFAULT_SORT, path: `/rankings/${slugifyDivision(d.name)}`, keep: keepQ };
  const href = (n: number) => `/rankings/${slugifyDivision(d.name)}?${new URLSearchParams({ ...(sex === "female" ? { sex } : {}), ...(typed ? { q: typed } : {}), ...sortQ, ...(n > 1 ? { page: String(n) } : {}) })}`;
  void archetype;

  return (
    <div>
      <BreadcrumbLd locale={t.locale} trail={[{ name: t("Rankings"), path: "/rankings" }, { name: t("{division} rankings", { division: t(d.name) }), path: `/rankings/${slugifyDivision(d.name)}` }]} />
      <div className="flex flex-wrap gap-1.5">
        {DIVISIONS_HEAVIEST_FIRST.map((x) => <Link key={x.name} href={`/rankings/${slugifyDivision(x.name)}${sexQ}`} className={`chip transition hover:text-ink ${x.name === d.name ? "!border-gold/50 !text-gold" : ""}`}>{t(x.short)}</Link>)}
      </div>
      <div className="eyebrow mb-2 mt-8">{limitLabel(d, t)}</div>
      <h1 className="font-display text-6xl font-extrabold uppercase leading-none">{divisionLabel(d.name, sex, t)}</h1>
      <div className="mt-4 flex gap-2"><Link href={`/rankings/${slugifyDivision(d.name)}`} className={`chip ${sex === "male" ? "!border-gold/50 !text-gold" : ""}`}>{t("Men")}</Link><Link href={`/rankings/${slugifyDivision(d.name)}?sex=female`} className={`chip ${sex === "female" ? "!border-gold/50 !text-gold" : ""}`}>{t("Women")}</Link></div>
      {lists.length > 0 && (
        <nav aria-label={t("Which ranking")} className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={`/rankings/${slugifyDivision(d.name)}`} aria-current={!official ? "page" : undefined} className={`chip ${!official ? "!border-gold/50 !text-gold" : ""}`}>{t("Ringside rating")}</Link>
          {RANKING_BODIES.map((b) => lists.some((l) => l.body === b) ? <Link key={b} href={`/rankings/${slugifyDivision(d.name)}?list=${b.toLowerCase()}`} aria-current={official?.body === b ? "page" : undefined} className={`chip ${official?.body === b ? "!border-gold/50 !text-gold" : ""}`}>{b}</Link> : null)}
        </nav>
      )}

      {official && <OfficialListView list={official} w={w} />}
      {!official && champ && (
        <Link href={`/boxers/${champ.boxer.slug}`} className="card card-hover mt-6 flex flex-wrap items-center gap-6 p-5">
          <Headshot boxer={champ.boxer} size={110} />
          <div>
            <div className="eyebrow">{t("Top rated")}</div>
            <div className="font-display text-4xl font-extrabold uppercase leading-tight">{t.name(champ.boxer.name)}</div>
            <div className="text-sm text-muted">{flag(champ.boxer.country)} {countryName(champ.boxer.country, t.locale)} · <bdi dir="ltr">{recordStr(champ.boxer)}</bdi> · {t("{n} KO", { n: champ.boxer.kos })}</div>
          </div>
          <div className="ms-auto text-end"><div className="font-display text-5xl font-bold text-gold tabular"><CountUp value={Math.round(champ.boxer.rating)} /></div><div className="text-xs text-muted">{t("Elo rating")}</div></div>
        </Link>
      )}

      {!official && <>
      <div className="mt-6" />
      {(pg.of > RANK_PAGE || typed) && <ListFinder path={`/rankings/${slugifyDivision(d.name)}`} hidden={{ ...(sex === "female" ? { sex } : {}), ...sortQ }} q={typed} label={t("Find a fighter in this division")} total={pg.total} of={pg.of} close={pg.close} />}
      <div className="card overflow-x-auto">
        {rows.length === 0 && !typed && (
          <div className="space-y-2 p-6 text-sm text-muted">
            <p>{t("No fighter in this division has the five fights on record that a ranking needs yet.")}</p>
            {rankingDepth(w).partialShare > 0.5 && <p>{t("These rankings count only the fights Ringside holds. Most fighters here have only their most recent fights on record so far, so few reach the five fights a ranking needs; more qualify as the history is added.")}</p>}
          </div>
        )}
        {rows.length > 0 && <table className="w-full text-sm" aria-label={t("{division} rankings", { division: divisionLabel(d.name, sex, t) })}>
          <thead><tr className="text-start text-xs uppercase tracking-widest text-muted">
            <SortTh label="#" column="rank" textual className="p-3" {...th} /><SortTh label={t("Fighter")} column="name" textual {...th} /><th className="hidden sm:table-cell">{t("Style")}</th><SortTh label={t("Record")} column="record" className="hidden min-[480px]:table-cell" {...th} /><SortTh label={t("KO%")} column="ko" className="hidden md:table-cell" {...th} /><SortTh label={t("Last fight")} column="last" className="hidden md:table-cell" {...th} /><SortTh label={t("Rating")} column="rating" end className="text-end" {...th} /><th className="p-3 text-end">{t("90d")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.boxer.id} className="row-hl border-t border-line/60 transition hover:bg-panel2/50">
                <td className={`p-3 font-display text-xl font-bold ${r.rank === 1 ? "text-gold" : ""}`}>{r.rank}</td>
                <td><Link href={`/boxers/${r.boxer.slug}`} className="flex items-center gap-3 py-2"><Headshot boxer={r.boxer} size={36} /><span><b>{t.name(r.boxer.name)}</b><span className="block text-xs text-muted">{flag(r.boxer.country)} {countryName(r.boxer.country, t.locale)} · {r.boxer.age}</span></span></Link></td>
                <td className="hidden sm:table-cell"><ArchBadge b={r.boxer} /></td>
                <td className="hidden tabular min-[480px]:table-cell">{recordStr(r.boxer)}</td>
                <td className="hidden tabular text-muted md:table-cell">{Math.round(koView(r.boxer).rate * 100)}%</td>
                <td className="hidden text-muted md:table-cell">{r.boxer.lastFight ? fmtDate(r.boxer.lastFight, { month: "short", year: "numeric" }, t.locale) : "—"}</td>
                <td className="text-end font-semibold tabular">{Math.round(r.boxer.rating)}</td>
                <td className="p-3 text-end"><div className="flex items-center justify-end gap-2"><bdi dir="ltr" className={`tabular text-xs ${r.ratingChange >= 0 ? "text-win" : "text-red-ink"}`}>{r.ratingChange >= 0 ? "+" : ""}{Math.round(r.ratingChange)}</bdi><Delta d={r.delta} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>}
        {!pg.of && <div className="p-8 text-center text-muted">{t("No qualifying fighters in this division yet.")}</div>}
      </div>
      <Pager page={pg.page} pages={pg.pages} href={href} />
      </>}
    </div>
  );
}
