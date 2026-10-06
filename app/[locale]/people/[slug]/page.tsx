import { ScrollRegion } from "@/components/ScrollRegion";
import Link from "@/components/L";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { BreadcrumbLd, JsonLd } from "@/components/JsonLd";
import { notFound } from "next/navigation";
import { getWorld } from "@/lib/world";
import { personStable } from "@/lib/team";
import { judgeStats, refereeStats } from "@/lib/officials";
import { TenureTable } from "@/components/TenureTable";
import { TeamTimeline } from "@/components/TeamTimeline";
import { TrainerImpactCard } from "@/components/TrainerImpactCard";
import { Pager, SectionTitle, Stat } from "@/components/ui";
import { countryName, flag, fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor } from "@/lib/seo-server";
import { paginate } from "@/lib/paging";
import { first, sectionHref, type Query } from "@/lib/section-page";

const ROLE_NAME: Record<string, string> = { trainer: msg("Trainer"), manager: msg("Manager"), judge: msg("Judge"), referee: msg("Referee") };

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; slug: string }> }) => metaFor(params, async (q, t) => {
  const w = await getWorld();
  const p = w.peopleBySlug.get(q.slug);
  if (!p) notFound();
  const roles = [...(w.roles.get(p.id) ?? [])];
  const name = t.name(p.name), role = roles.map((r) => t(ROLE_NAME[r] ?? r)).join(" / ");
  const stable = roles.includes("trainer") ? personStable(w, p.id, ["head_trainer"]) : roles.includes("manager") ? personStable(w, p.id, ["manager"]) : null;
  const j = roles.includes("judge") ? judgeStats(w).judges.find((x) => x.person.id === p.id) : null;
  const r = roles.includes("referee") ? refereeStats(w).referees.find((x) => x.person.id === p.id) : null;
  const description = stable ? t("{name} ({role}): {fighters} fighters on record, {record} together, {titles} title wins, with dated team history and Elo change per tenure.", { name, role, fighters: stable.fighters, record: `${stable.record.wins}-${stable.record.losses}-${stable.record.draws}`, titles: stable.titleWins })
    : j ? t("{name} ({role}): {cards} cards scored, with the majority on {pct}% of them and {dissents} dissents, plus recent bouts judged.", { name, role, cards: j.cards, pct: Math.round(j.agreeWithMajority * 100), dissents: j.dissents })
    : r ? t("{name} ({role}): {bouts} bouts officiated, {stoppages} stoppages and a {pct}% stoppage rate, plus recent bouts refereed.", { name, role, bouts: r.bouts, stoppages: r.stoppages, pct: Math.round(r.stopRate * 100) })
    : t("{name} ({role}) on Ringside: team history, fighters worked with and results across the boxing league.", { name, role: role || t("Person") });
  return { path: `/people/${q.slug}`, title: name, description };
});

/** Rows per page of the long lists on a person's page: a trainer's stable, a manager's clients, the bouts a judge scored or a referee officiated. */
const TENURES_PAGE = 40, BOUTS_PAGE = 12;

export default async function PersonPage({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Query> }) {
  const t = await getT();
  const { slug } = await params;
  const query = await searchParams;
  const here = `/people/${slug}`;
  const at = (key: string, label: string) => ({ page: first(query[key]), href: (n: number) => sectionHref(here, query, key, n), label });
  const w = await getWorld();
  const p = w.peopleBySlug.get(slug);
  if (!p) notFound();
  const roles = [...(w.roles.get(p.id) ?? [])];
  const trainer = roles.includes("trainer") ? personStable(w, p.id, ["head_trainer", "assistant_trainer", "strength_coach", "cutman"]) : null;
  const head = roles.includes("trainer") ? personStable(w, p.id, ["head_trainer"]) : null;
  const manager = roles.includes("manager") ? personStable(w, p.id, ["manager"]) : null;
  const judge = roles.includes("judge") ? judgeStats(w) : null;
  const ref = roles.includes("referee") ? refereeStats(w) : null;
  const myJudge = judge?.judges.find((j) => j.person.id === p.id);
  const myRef = ref?.referees.find((r) => r.person.id === p.id);

  // One lane per fighter: a trainer works with several fighters at once, so a single shared lane would overlap.
  const timelineRows = head
    ? [...head.tenures].sort((a, b) => (a.stint.start ?? "").localeCompare(b.stint.start ?? "")).slice(-16).map((x) => ({
        label: t.name(x.boxer.name), color: "#d9b25f",
        segments: [{ from: x.stint.start, to: x.stint.end, label: `${x.record.wins}-${x.record.losses}-${x.record.draws}`, sub: x.ratingChange === null ? undefined : t("{n} Elo", { n: `${x.ratingChange >= 0 ? "+" : ""}${Math.round(x.ratingChange)}` }), href: `/boxers/${x.boxer.slug}`, current: x.current }],
      }))
    : [];

  // recent bouts for officials
  const officiated = (kind: "judge" | "referee") =>
    // this person's own assignments, newest first: no need to walk every bout in the league
    (w.officialsByPerson.get(p.id) ?? [])
      .filter((o) => o.role === kind)
      .flatMap((o) => { const b = w.boutById.get(o.boutId); return b && !b.upcoming ? [b] : []; })
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  /** One page of them, newest first; `key` is the page's address for it. */
  const recentBouts = (kind: "judge" | "referee", key: string) => {
    const all = officiated(kind), pg = paginate(all.length, first(query[key]), BOUTS_PAGE);
    return { pg, key, rows: all.slice(pg.first, pg.first + BOUTS_PAGE)
      .map((b) => {
        const card = kind === "judge" ? (w.scorecardsByBout.get(b.id) ?? []).find((c) => c.judgeId === p.id) : null;
        return { id: b.id, label: t("{red} vs {blue}", { red: t.name(b.redName), blue: t.name(b.blueName) }), date: b.date, result: methodLabel(b.method, b.endRound, t), detail: card ? `${card.red}–${card.blue}` : "" };
      }) };
  };
  // the bouts they scored or officiated, a page of each (only for the roles this person has)
  const judged = recentBouts("judge", "judged"), refereed = recentBouts("referee", "refereed");

  return (
    <div className="space-y-10">
      <BreadcrumbLd locale={t.locale} trail={[{ name: t("Corners & officials"), path: "/people" }, { name: t.name(p.name), path: `/people/${p.slug}` }]} />
      <JsonLd data={{ "@type": "Person", name: t.name(p.name), jobTitle: roles.map((r) => ROLE_NAME[r] ?? r).join(", "), ...(p.country ? { nationality: { "@type": "Country", name: p.country } } : {}), url: abs(localePath(t.locale, `/people/${p.slug}`)), inLanguage: t.locale }} />
      <section className="rise">
        <div className="flex flex-wrap items-center gap-2">{roles.map((r) => <span key={r} className="chip !border-gold/40 !text-gold">{t(ROLE_NAME[r] ?? r)}</span>)}</div>
        <h1 className="mt-3 font-display text-6xl font-extrabold uppercase leading-[.95]">{t.name(p.name)}</h1>
        {p.country && <div className="mt-2 text-muted">{flag(p.country)} {countryName(p.country, t.locale)}</div>}
      </section>

      {head && (
        <section className="space-y-5">
          <SectionTitle eyebrow={t("As head trainer")} title={t("Stable")} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Fighters")} value={head.fighters} sub={t("{n} current", { n: head.currentFighters })} />
            <Stat label={t("Record together")} value={`${head.record.wins}-${head.record.losses}-${head.record.draws}`} sub={t("{wins}% wins · {ko}% KO", { wins: Math.round(head.record.winRate * 100), ko: Math.round(head.record.koRate * 100) })} />
            <Stat label={t("Title wins")} value={head.titleWins} />
            <Stat label={t("Avg Elo change")} value={head.avgRatingChange === null ? "–" : `${head.avgRatingChange >= 0 ? "+" : ""}${Math.round(head.avgRatingChange)}`} sub={t("per tenure")} />
          </div>
          {timelineRows.length > 0 && <div className="card p-5"><div className="eyebrow mb-3">{head.tenures.length > 16 ? t("Fighters over time (latest 16 of {n})", { n: head.tenures.length }) : t("Fighters over time")}</div><TeamTimeline rows={timelineRows} today={w.today} /></div>}
          <div className="card p-5"><TenureTable tenures={head.tenures} limit={TENURES_PAGE} pager={at("stable", t("Pages of fighters"))} /></div>
          {trainer && trainer.tenures.length > head.tenures.length && <p className="text-xs text-muted">{t("Also worked in other corner roles (assistant, strength and conditioning) with {n} further fighters.", { n: trainer.fighters - head.fighters })}</p>}
        </section>
      )}

      {head && head.tenures.length > 0 && <TrainerImpactCard w={w} personId={p.id} />}

      {manager && (
        <section className="space-y-5">
          <SectionTitle eyebrow={t("As manager")} title={t("Clients")} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Clients")} value={manager.fighters} sub={t("{n} current", { n: manager.currentFighters })} />
            <Stat label={t("Record")} value={`${manager.record.wins}-${manager.record.losses}-${manager.record.draws}`} sub={t("{n}% wins", { n: Math.round(manager.record.winRate * 100) })} />
            <Stat label={t("Title wins")} value={manager.titleWins} />
          </div>
          <div className="card p-5"><TenureTable tenures={manager.tenures} limit={TENURES_PAGE} pager={at("clients", t("Pages of clients"))} /></div>
        </section>
      )}

      {myJudge && judge && (
        <section className="space-y-5">
          <SectionTitle eyebrow={t("As judge")} title={t("Scoring record")} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Cards scored")} value={myJudge.cards} />
            <Stat label={t("With majority")} value={`${Math.round(myJudge.agreeWithMajority * 100)}%`} sub={t.n(myJudge.dissents, "{n} dissent", "{n} dissents")} />
            <Stat label={t("Avg margin")} value={myJudge.avgMargin.toFixed(1)} sub={t("points")} />
            <Stat label={t("Picks home fighter")} value={myJudge.homePickRate === null ? "–" : `${Math.round(myJudge.homePickRate * 100)}%`} sub={t("league {pct}% · n={n}", { pct: Math.round(judge.leagueHomePickRate * 100), n: myJudge.homeSamples })} />
          </div>
          <ScrollRegion className="card p-5" label={t("Scoring record")}>
            <table className="w-full text-sm" aria-label={t("Scoring record")}><tbody>{judged.rows.map((b) => (
              <tr key={b.id} className="border-t border-line/60 first:border-0"><td className="hidden whitespace-nowrap py-2 pe-3 text-muted tabular sm:table-cell">{fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</td><td className="py-2 sm:py-0"><span className="block text-xs text-muted tabular sm:hidden">{fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</span><Link href={`/bouts/${b.id}`} className="hover:text-gold">{b.label}</Link></td><td className="whitespace-nowrap px-3 tabular text-muted">{b.result}</td><td className="whitespace-nowrap text-end tabular font-semibold">{b.detail}</td></tr>
            ))}</tbody></table>
          </ScrollRegion>
          <Pager page={judged.pg.page} pages={judged.pg.pages} href={(n) => sectionHref(here, query, judged.key, n)} label={t("Pages of bouts scored")} />
        </section>
      )}

      {myRef && ref && (
        <section className="space-y-5">
          <SectionTitle eyebrow={t("As referee")} title={t("Officiating record")} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Bouts")} value={myRef.bouts} />
            <Stat label={t("Stoppages")} value={myRef.stoppages} sub={t("{n}% of bouts", { n: Math.round(myRef.stopRate * 100) })} />
            <Stat label={t("Avg stoppage round")} value={myRef.avgStopRound?.toFixed(2) ?? "–"} sub={t("league {n}", { n: ref.leagueAvgStopRound.toFixed(2) })} />
            <Stat label={t("Early stoppages")} value={`${Math.round(myRef.earlyStopRate * 100)}%`} sub={t("rounds 1–3")} />
          </div>
          <ScrollRegion className="card p-5" label={t("Officiating record")}>
            <table className="w-full text-sm" aria-label={t("Officiating record")}><tbody>{refereed.rows.map((b) => (
              <tr key={b.id} className="border-t border-line/60 first:border-0"><td className="hidden whitespace-nowrap py-2 pe-3 text-muted tabular sm:table-cell">{fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</td><td className="py-2 sm:py-0"><span className="block text-xs text-muted tabular sm:hidden">{fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</span><Link href={`/bouts/${b.id}`} className="hover:text-gold">{b.label}</Link></td><td className="whitespace-nowrap ps-3 text-end tabular text-muted">{b.result}</td></tr>
            ))}</tbody></table>
          </ScrollRegion>
          <Pager page={refereed.pg.page} pages={refereed.pg.pages} href={(n) => sectionHref(here, query, refereed.key, n)} label={t("Pages of bouts refereed")} />
        </section>
      )}
    </div>
  );
}
