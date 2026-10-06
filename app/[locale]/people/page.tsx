import { ScrollRegion } from "@/components/ScrollRegion";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { personStable, trainerLeaderboard } from "@/lib/team";
import { judgeStats, refereeStats, scoringDisputes } from "@/lib/officials";
import { Pager, SectionTitle } from "@/components/ui";
import { pageRanked, ranked } from "@/lib/people-list";
import { SortTh } from "@/components/SortTh";
import { parseSort, sortQuery, sortRanked, type Sort } from "@/lib/table-sort";
import { ListFinder } from "@/components/ListFinder";
import { getNames } from "@/lib/i18n/names";
import { flag, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor, pagedTitle, tabbedTitle, type SearchParams } from "@/lib/seo-server";

export const generateMetadata = ({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) => metaFor(params, (p, t, sp) => ({ path: "/people", title: pagedTitle(t, tabbedTitle(t, t("Corners & officials"), TABS, sp.role), sp.page), description: t("Leaderboards for trainers, managers, judges and referees: who trains, manages, scores and officiates, with dated team histories and results.") }), searchParams);

const TABS = [["trainer", msg("Trainers")], ["manager", msg("Managers")], ["judge", msg("Judges")], ["referee", msg("Referees")]] as const;

export default async function People({ searchParams }: { searchParams: Promise<{ role?: string; sort?: string; dir?: string; q?: string; page?: string }> }) {
  const t = await getT();
  const { role = "trainer", sort = "", dir = "", q = "", page } = await searchParams;
  const w = await getWorld();
  const names = await getNames(t.locale);
  const tab = TABS.some(([k]) => k === role) ? role : "trainer";
  const list = { q: q.slice(0, 80), page, names, tab, sort, dir };

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("The people behind the fights")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Corners & officials")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Who trains, manages, scores and referees. Every fighter’s team history is tracked with dates, so you can see how fighters did before, during and after a trainer.")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => <Link key={k} href={`/people?role=${k}`} className={`chip ${tab === k ? "!border-gold/50 !text-gold" : ""}`}>{t(label)}</Link>)}
      </div>
      {tab === "trainer" && <Trainers w={w} list={list} />}
      {tab === "manager" && <Managers w={w} list={list} />}
      {tab === "judge" && <Judges w={w} list={list} />}
      {tab === "referee" && <Referees w={w} list={list} />}
    </div>
  );
}

type W = Awaited<ReturnType<typeof getWorld>>;
type List = { q: string; page?: string; names: Awaited<ReturnType<typeof getNames>>; tab: string; sort: string; dir: string };

const th = "py-2 text-start text-xs font-normal uppercase tracking-widest text-muted";
/** What else the address of a leaderboard carries besides the page and the name: the tab and the column it is sorted by (a clean address for the default order). */
const hiddenOf = (list: List, sortQ: Record<string, string> = {}): Record<string, string> => ({ role: list.tab, ...sortQ });

/** A leaderboard's columns: what each is sorted on, and whether it is text (A to Z first) or a figure (most first). `rank` is the table's own order. */
type Col<R> = { textual: boolean; get: (r: R) => number | string | null };
type Cols<R> = Record<string, Col<R>>;

/** One leaderboard, put in the order asked for (?sort=win&dir=desc), filtered by name, and cut to a page; each row keeps its place in the default order, and the address of any page keeps the tab, the sort and the name typed. */
function pageOf<R>(rows: R[], nameOf: (r: R) => string, list: List, cols: Cols<R>, def: Sort) {
  const sort = parseSort({ sort: list.sort, dir: list.dir }, cols, def), sortQ = sortQuery(sort, def);
  const sorted = sortRanked(ranked(rows), sort, (r) => cols[sort.key].get(r));
  const found = pageRanked(sorted, nameOf, list);
  const href = (n: number) => `/people?${new URLSearchParams({ role: list.tab, ...sortQ, ...(list.q ? { q: list.q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
  const head = { current: sort, fallback: def, path: "/people", keep: { role: list.tab, ...(list.q ? { q: list.q } : {}) } };
  return { ...found, href, sortQ, head };
}
const RANK_DEF: Sort = { key: "rank", dir: "asc" };

async function Trainers({ w, list }: { w: W; list: List }) {
  const t = await getT();
  const rows = [...trainerLeaderboard(w, 4)]; // a copy: the leaderboard is shared between requests
  rows.sort((a, b) => (b.stable.avgRatingChange ?? -999) - (a.stable.avgRatingChange ?? -999)); // the board's own order, which is what the # column counts
  type TR = (typeof rows)[0];
  const cols: Cols<TR> = { rank: { textual: true, get: () => null }, name: { textual: true, get: (r) => r.person.name }, fighters: { textual: false, get: (r) => r.stable.fighters }, record: { textual: false, get: (r) => r.stable.record.wins }, win: { textual: false, get: (r) => r.stable.record.winRate }, titles: { textual: false, get: (r) => r.stable.titleWins }, elo: { textual: false, get: (r) => r.stable.avgRatingChange } };
  const pg = pageOf(rows, (r) => r.person.name, list, cols, { key: "elo", dir: "desc" }); // ?sort=win, fighters, titles and elo (the old chips) still work, now with a direction
  return (
    <section>
      <SectionTitle eyebrow={t("Head trainers with 4+ fights on record")} title={t("Trainer leaderboard")} href="/trainers" cta={t("Trainer impact: what the data can say")} />
      <ListFinder path="/people" hidden={hiddenOf(list, pg.sortQ)} q={list.q} label={t("Find a trainer by name")} total={pg.total} of={pg.of} close={pg.close} />
      <ScrollRegion className="card p-4" label={t("Trainer leaderboard")}>
        <table className="w-full text-sm" aria-label={t("Trainer leaderboard")}>
          <thead><tr><SortTh label="#" column="rank" textual className={th} {...pg.head} /><SortTh label={t("Trainer")} column="name" textual className={th} {...pg.head} /><SortTh label={t("Fighters now / ever")} column="fighters" className={th} {...pg.head} /><SortTh label={t("Record together")} column="record" className={th} {...pg.head} /><SortTh label={t("Win%")} column="win" className={th} {...pg.head} /><SortTh label={t("Titles")} column="titles" className={th} {...pg.head} /><SortTh label={t("Avg Elo change")} column="elo" className={`${th} text-end`} end {...pg.head} /></tr></thead>
          <tbody>
            {pg.shown.map(({ row: r, rank }) => (
              <tr key={r.person.id} className="border-t border-line/60">
                <td className="py-2.5 font-display text-lg font-bold text-muted">{rank}</td>
                <td><Link href={`/people/${r.person.slug}`} className="hover:text-gold"><b>{t.name(r.person.name)}</b> <span className="text-xs text-muted">{r.person.country ? flag(r.person.country) : ""}</span></Link></td>
                <td className="tabular">{r.stable.currentFighters} / {r.stable.fighters}</td>
                <td className="tabular">{r.stable.record.wins}-{r.stable.record.losses}-{r.stable.record.draws}</td>
                <td className="tabular">{Math.round(r.stable.record.winRate * 100)}%</td>
                <td className="tabular">{r.stable.titleWins}</td>
                <td className={`text-end tabular font-semibold ${(r.stable.avgRatingChange ?? 0) >= 0 ? "text-win" : "text-red-ink"}`}><bdi dir="ltr">{r.stable.avgRatingChange === null ? "–" : `${r.stable.avgRatingChange >= 0 ? "+" : ""}${Math.round(r.stable.avgRatingChange)}`}</bdi></td>
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
  type MR = (typeof rows)[0];
  const cols: Cols<MR> = { rank: { textual: true, get: () => null }, name: { textual: true, get: (r) => r.p.name }, fighters: { textual: false, get: (r) => r.s.fighters }, record: { textual: false, get: (r) => r.s.record.wins }, win: { textual: false, get: (r) => r.s.record.winRate }, titles: { textual: false, get: (r) => r.s.titleWins } };
  const pg = pageOf(rows, ({ p }) => p.name, list, cols, RANK_DEF);
  return (
    <section>
      <SectionTitle eyebrow={t("By number of fighters managed")} title={t("Managers")} />
      <ListFinder path="/people" hidden={hiddenOf(list, pg.sortQ)} q={list.q} label={t("Find a manager by name")} total={pg.total} of={pg.of} close={pg.close} />
      <ScrollRegion className="card p-4" label={t("Managers")}>
        <table className="w-full text-sm" aria-label={t("Managers")}>
          <thead><tr><SortTh label={t("Manager")} column="name" textual className={th} {...pg.head} /><SortTh label={t("Clients now / ever")} column="fighters" className={th} {...pg.head} /><SortTh label={t("Record")} column="record" className={th} {...pg.head} /><SortTh label={t("Win%")} column="win" className={th} {...pg.head} /><SortTh label={t("Title wins")} column="titles" className={`${th} text-end`} end {...pg.head} /></tr></thead>
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
  type JR = (typeof judges)[0];
  const cols: Cols<JR> = { rank: { textual: true, get: () => null }, name: { textual: true, get: (j) => j.person.name }, cards: { textual: false, get: (j) => j.cards }, majority: { textual: false, get: (j) => j.agreeWithMajority }, dissents: { textual: false, get: (j) => j.dissents }, margin: { textual: false, get: (j) => j.avgMargin }, home: { textual: false, get: (j) => j.homePickRate } };
  const pg = pageOf(judges, (j) => j.person.name, list, cols, RANK_DEF);
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle eyebrow={t("How often each judge sides with the majority")} title={t("Judges")} />
        <ListFinder path="/people" hidden={hiddenOf(list, pg.sortQ)} q={list.q} label={t("Find a judge by name")} total={pg.total} of={pg.of} close={pg.close} />
        <ScrollRegion className="card p-4" label={t("Judges")}>
          <table className="w-full text-sm" aria-label={t("Judges")}>
            <thead><tr><SortTh label={t("Judge")} column="name" textual className={th} {...pg.head} /><SortTh label={t("Cards")} column="cards" className={th} {...pg.head} /><SortTh label={t("With majority")} column="majority" className={th} {...pg.head} /><SortTh label={t("Dissents")} column="dissents" className={th} {...pg.head} /><SortTh label={t("Avg margin")} column="margin" className={th} {...pg.head} /><SortTh label={t("Picks the home fighter")} column="home" className={`${th} text-end`} end {...pg.head} /></tr></thead>
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
              <div className="mt-1 text-xs text-muted">{t.name(d.bout.eventName)} · {fmtDate(d.bout.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</div>
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
  type RR = (typeof referees)[0];
  const cols: Cols<RR> = { rank: { textual: true, get: () => null }, name: { textual: true, get: (r) => r.person.name }, bouts: { textual: false, get: (r) => r.bouts }, stops: { textual: false, get: (r) => r.stoppages }, rate: { textual: false, get: (r) => r.stopRate }, early: { textual: false, get: (r) => r.earlyStopRate }, avg: { textual: false, get: (r) => r.avgStopRound } };
  const pg = pageOf(referees, (r) => r.person.name, list, cols, RANK_DEF);
  return (
    <section>
      <SectionTitle eyebrow={t("League average stoppage: round {n}", { n: leagueAvgStopRound.toFixed(1) })} title={t("Referees")} />
      <ListFinder path="/people" hidden={hiddenOf(list, pg.sortQ)} q={list.q} label={t("Find a referee by name")} total={pg.total} of={pg.of} close={pg.close} />
      <ScrollRegion className="card p-4" label={t("Referees")}>
        <table className="w-full text-sm" aria-label={t("Referees")}>
          <thead><tr><SortTh label={t("Referee")} column="name" textual className={th} {...pg.head} /><SortTh label={t("Bouts")} column="bouts" className={th} {...pg.head} /><SortTh label={t("Stoppages")} column="stops" className={th} {...pg.head} /><SortTh label={t("Stoppage rate")} column="rate" className={th} {...pg.head} /><SortTh label={t("Early (R1–3)")} column="early" className={th} {...pg.head} /><SortTh label={t("Avg stoppage round")} column="avg" className={`${th} text-end`} end {...pg.head} /></tr></thead>
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
