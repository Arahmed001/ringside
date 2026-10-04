import { ScrollRegion } from "@/components/ScrollRegion";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { personStable, trainerLeaderboard } from "@/lib/team";
import { judgeStats, refereeStats, scoringDisputes } from "@/lib/officials";
import { Pager, SectionTitle } from "@/components/ui";
import { pageRows } from "@/lib/people-list";
import { ListFinder } from "@/components/ListFinder";
import { getNames } from "@/lib/i18n/names";
import { flag } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor, pagedTitle, tabbedTitle, type SearchParams } from "@/lib/seo-server";

export const generateMetadata = ({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) => metaFor(params, (p, t, sp) => ({ path: "/people", title: pagedTitle(t, tabbedTitle(t, t("Corners & officials"), TABS, sp.role), sp.page), description: t("Leaderboards for trainers, managers, judges and referees: who trains, manages, scores and officiates, with dated team histories and results.") }), searchParams);

const TABS = [["trainer", msg("Trainers")], ["manager", msg("Managers")], ["judge", msg("Judges")], ["referee", msg("Referees")]] as const;

export default async function People({ searchParams }: { searchParams: Promise<{ role?: string; sort?: string; q?: string; page?: string }> }) {
  const t = await getT();
  const { role = "trainer", sort = "elo", q = "", page } = await searchParams;
  const w = await getWorld();
  const names = await getNames(t.locale);
  const tab = TABS.some(([k]) => k === role) ? role : "trainer";
  const list = { q: q.slice(0, 80), page, names, tab, sort };

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("The people behind the fights")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Corners & officials")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Who trains, manages, scores and referees. Every fighter's team history is tracked with dates, so you can see how fighters did before, during and after a trainer.")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => <Link key={k} href={`/people?role=${k}`} className={`chip ${tab === k ? "!border-gold/50 !text-gold" : ""}`}>{t(label)}</Link>)}
      </div>
      {tab === "trainer" && <Trainers sort={sort} w={w} list={list} />}
      {tab === "manager" && <Managers w={w} list={list} />}
      {tab === "judge" && <Judges w={w} list={list} />}
      {tab === "referee" && <Referees w={w} list={list} />}
    </div>
  );
}

type W = Awaited<ReturnType<typeof getWorld>>;
type List = { q: string; page?: string; names: Awaited<ReturnType<typeof getNames>>; tab: string; sort: string };

const th = "py-2 text-start text-xs font-normal uppercase tracking-widest text-muted";
/** What else the address of a leaderboard carries besides the page and the name: the tab and, for trainers, a sort other than the default. */
const hiddenOf = (list: List): Record<string, string> => ({ role: list.tab, ...(list.tab === "trainer" && list.sort !== "elo" ? { sort: list.sort } : {}) });

/** One leaderboard, filtered and cut to a page, with the address of any page of it (it keeps the tab, the sort and the name typed). */
function pageOf<T>(rows: T[], nameOf: (r: T) => string, list: List) {
  const found = pageRows(rows, nameOf, list);
  const href = (n: number) => `/people?${new URLSearchParams({ role: list.tab, ...(list.tab === "trainer" && list.sort !== "elo" ? { sort: list.sort } : {}), ...(list.q ? { q: list.q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
  return { ...found, href };
}

async function Trainers({ sort, w, list }: { sort: string; w: W; list: List }) {
  const t = await getT();
  const rows = [...trainerLeaderboard(w, 4)]; // a copy: the leaderboard is shared between requests
  const key = { elo: (r: (typeof rows)[0]) => r.stable.avgRatingChange ?? -999, win: (r: (typeof rows)[0]) => r.stable.record.winRate, fighters: (r: (typeof rows)[0]) => r.stable.fighters, titles: (r: (typeof rows)[0]) => r.stable.titleWins }[sort] ?? ((r: (typeof rows)[0]) => r.stable.avgRatingChange ?? -999);
  rows.sort((a, b) => key(b) - key(a));
  const pg = pageOf(rows, (r) => r.person.name, list);
  return (
    <section>
      <SectionTitle eyebrow={t("Head trainers with 4+ fights on record")} title={t("Trainer leaderboard")} href="/trainers" cta={t("Trainer impact: what the data can say")} />
      <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="text-muted">{t("Sort by")}</span>{[["elo", msg("Elo change")], ["win", msg("Win rate")], ["fighters", msg("Fighters")], ["titles", msg("Title wins")]].map(([k, l]) => <Link key={k} href={`/people?role=trainer&sort=${k}`} className={`chip ${sort === k ? "!border-gold/50 !text-gold" : ""}`}>{t(l)}</Link>)}</div>
      <ListFinder path="/people" hidden={hiddenOf(list)} q={list.q} label={t("Find a trainer by name")} total={pg.total} of={pg.of} close={pg.close} />
      <ScrollRegion className="card p-4" label={t("Trainer leaderboard")}>
        <table className="w-full text-sm" aria-label={t("Trainer leaderboard")}>
          <thead><tr><th className={th}>#</th><th className={th}>{t("Trainer")}</th><th className={th}>{t("Fighters now / ever")}</th><th className={th}>{t("Record together")}</th><th className={th}>{t("Win%")}</th><th className={th}>{t("Titles")}</th><th className={`${th} text-end`}>{t("Avg Elo change")}</th></tr></thead>
          <tbody>
            {pg.shown.map(({ row: r, rank }) => (
              <tr key={r.person.id} className="border-t border-line/60">
                <td className="py-2.5 font-display text-lg font-bold text-muted">{rank}</td>
                <td><Link href={`/people/${r.person.slug}`} className="hover:text-gold"><b>{t.name(r.person.name)}</b> <span className="text-xs text-muted">{r.person.country ? flag(r.person.country) : ""}</span></Link></td>
                <td className="tabular">{r.stable.currentFighters} / {r.stable.fighters}</td>
                <td className="tabular">{r.stable.record.wins}-{r.stable.record.losses}-{r.stable.record.draws}</td>
                <td className="tabular">{Math.round(r.stable.record.winRate * 100)}%</td>
                <td className="tabular">{r.stable.titleWins}</td>
                <td className={`text-end tabular font-semibold ${(r.stable.avgRatingChange ?? 0) >= 0 ? "text-win" : "text-red-ink"}`}>{r.stable.avgRatingChange === null ? "–" : `${r.stable.avgRatingChange >= 0 ? "+" : ""}${Math.round(r.stable.avgRatingChange)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <Pager page={pg.page} pages={pg.pages} href={pg.href} />
      <p className="mt-3 text-xs text-muted">{t("Elo change is the average rating gain (or loss) a fighter had during each tenure. It reflects the fighter as much as the trainer, since trainers also pick up and lose fighters at different career stages. Treat it as a lead, not a verdict.")}</p>
    </section>
  );
}

async function Managers({ w, list }: { w: W; list: List }) {
  const t = await getT();
  const rows = [...w.people.values()].filter((p) => w.roles.get(p.id)?.has("manager")).map((p) => ({ p, s: personStable(w, p.id, ["manager"]) })).filter((r) => r.s.record.bouts >= 4).sort((a, b) => b.s.fighters - a.s.fighters);
  const pg = pageOf(rows, ({ p }) => p.name, list);
  return (
    <section>
      <SectionTitle eyebrow={t("By number of fighters managed")} title={t("Managers")} />
      <ListFinder path="/people" hidden={hiddenOf(list)} q={list.q} label={t("Find a manager by name")} total={pg.total} of={pg.of} close={pg.close} />
      <ScrollRegion className="card p-4" label={t("Managers")}>
        <table className="w-full text-sm" aria-label={t("Managers")}>
          <thead><tr><th className={th}>{t("Manager")}</th><th className={th}>{t("Clients now / ever")}</th><th className={th}>{t("Record")}</th><th className={th}>{t("Win%")}</th><th className={`${th} text-end`}>{t("Title wins")}</th></tr></thead>
          <tbody>{pg.shown.map(({ row: { p, s } }) => (
            <tr key={p.id} className="border-t border-line/60"><td className="py-2.5"><Link href={`/people/${p.slug}`} className="hover:text-gold"><b>{t.name(p.name)}</b></Link></td><td className="tabular">{s.currentFighters} / {s.fighters}</td><td className="tabular">{s.record.wins}-{s.record.losses}-{s.record.draws}</td><td className="tabular">{Math.round(s.record.winRate * 100)}%</td><td className="text-end tabular">{s.titleWins}</td></tr>
          ))}</tbody>
        </table>
      </ScrollRegion>
      <Pager page={pg.page} pages={pg.pages} href={pg.href} />
    </section>
  );
}

async function Judges({ w, list }: { w: W; list: List }) {
  const t = await getT();
  const { judges, leagueHomePickRate } = judgeStats(w);
  const disputes = scoringDisputes(w, 6);
  const pg = pageOf(judges, (j) => j.person.name, list);
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle eyebrow={t("How often each judge sides with the majority")} title={t("Judges")} />
        <ListFinder path="/people" hidden={hiddenOf(list)} q={list.q} label={t("Find a judge by name")} total={pg.total} of={pg.of} close={pg.close} />
        <ScrollRegion className="card p-4" label={t("Judges")}>
          <table className="w-full text-sm" aria-label={t("Judges")}>
            <thead><tr><th className={th}>{t("Judge")}</th><th className={th}>{t("Cards")}</th><th className={th}>{t("With majority")}</th><th className={th}>{t("Dissents")}</th><th className={th}>{t("Avg margin")}</th><th className={`${th} text-end`}>{t("Picks the home fighter")}</th></tr></thead>
            <tbody>{pg.shown.map(({ row: j }) => {
              const diff = j.homePickRate === null ? null : j.homePickRate - leagueHomePickRate;
              return (
                <tr key={j.person.id} className="border-t border-line/60">
                  <td className="py-2.5"><Link href={`/people/${j.person.slug}`} className="hover:text-gold"><b>{t.name(j.person.name)}</b></Link></td>
                  <td className="tabular">{j.cards}</td><td className="tabular">{Math.round(j.agreeWithMajority * 100)}%</td><td className="tabular">{j.dissents}</td><td className="tabular">{j.avgMargin.toFixed(1)}</td>
                  <td className="text-end tabular">{j.homePickRate === null ? "–" : <><span className={Math.abs(diff!) >= 0.06 && j.homeSamples >= 40 ? (diff! > 0 ? "font-semibold text-gold" : "font-semibold text-blue") : ""}>{Math.round(j.homePickRate * 100)}%</span><span className="ms-1.5 text-xs text-muted">{t("n={n}", { n: j.homeSamples })}</span></>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </ScrollRegion>
        <Pager page={pg.page} pages={pg.pages} href={pg.href} />
        <p className="mt-3 text-xs text-muted">{t("“Picks the home fighter” counts decisive cards in bouts where exactly one fighter was a home national (league average {pct}%). With fewer than about 40 such cards the number is mostly noise.", { pct: Math.round(leagueHomePickRate * 100) })}</p>
      </section>
      {!list.q && pg.page === 1 && <section>
        <SectionTitle eyebrow={t("Widest disagreement between judges")} title={t("Scoring disputes")} />
        <div className="grid gap-3 md:grid-cols-2">
          {disputes.map((d) => (
            <Link key={d.bout.id} href={`/bouts/${d.bout.id}`} className="card card-hover p-4 text-sm">
              <div><b>{t.name(d.bout.redName)}</b> <span className="text-muted">{t("vs")}</span> <b>{t.name(d.bout.blueName)}</b></div>
              <div className="mt-1 text-xs text-muted">{t.name(d.bout.eventName)} · {d.bout.date}</div>
              <div className="mt-2 flex flex-wrap gap-2 tabular">{d.cards.map((c, i) => <span key={i} className="chip">{c.red}–{c.blue}</span>)}</div>
            </Link>
          ))}
        </div>
      </section>}
    </div>
  );
}

async function Referees({ w, list }: { w: W; list: List }) {
  const t = await getT();
  const { referees, leagueAvgStopRound } = refereeStats(w);
  const pg = pageOf(referees, (r) => r.person.name, list);
  return (
    <section>
      <SectionTitle eyebrow={t("League average stoppage: round {n}", { n: leagueAvgStopRound.toFixed(1) })} title={t("Referees")} />
      <ListFinder path="/people" hidden={hiddenOf(list)} q={list.q} label={t("Find a referee by name")} total={pg.total} of={pg.of} close={pg.close} />
      <ScrollRegion className="card p-4" label={t("Referees")}>
        <table className="w-full text-sm" aria-label={t("Referees")}>
          <thead><tr><th className={th}>{t("Referee")}</th><th className={th}>{t("Bouts")}</th><th className={th}>{t("Stoppages")}</th><th className={th}>{t("Stoppage rate")}</th><th className={th}>{t("Early (R1–3)")}</th><th className={`${th} text-end`}>{t("Avg stoppage round")}</th></tr></thead>
          <tbody>{pg.shown.map(({ row: r }) => (
            <tr key={r.person.id} className="border-t border-line/60"><td className="py-2.5"><Link href={`/people/${r.person.slug}`} className="hover:text-gold"><b>{t.name(r.person.name)}</b></Link></td><td className="tabular">{r.bouts}</td><td className="tabular">{r.stoppages}</td><td className="tabular">{Math.round(r.stopRate * 100)}%</td><td className="tabular">{Math.round(r.earlyStopRate * 100)}%</td>
              <td className={`text-end tabular font-semibold ${r.avgStopRound !== null && r.stoppages >= 15 && r.avgStopRound < leagueAvgStopRound - 0.5 ? "text-gold" : ""}`}>{r.avgStopRound?.toFixed(2) ?? "–"}</td></tr>
          ))}</tbody>
        </table>
      </ScrollRegion>
      <Pager page={pg.page} pages={pg.pages} href={pg.href} />
    </section>
  );
}
