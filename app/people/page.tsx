import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import { personStable, trainerLeaderboard } from "@/lib/team";
import { judgeStats, refereeStats, scoringDisputes } from "@/lib/officials";
import { SectionTitle } from "@/components/ui";
import { flag } from "@/lib/format";

export const metadata: Metadata = { title: "Corners & officials" };

const TABS = [["trainer", "Trainers"], ["manager", "Managers"], ["judge", "Judges"], ["referee", "Referees"]] as const;

export default async function People({ searchParams }: { searchParams: Promise<{ role?: string; sort?: string }> }) {
  const { role = "trainer", sort = "elo" } = await searchParams;
  const w = await getWorld();
  const tab = TABS.some(([k]) => k === role) ? role : "trainer";

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">The people behind the fights</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">Corners &amp; officials</h1>
        <p className="mt-2 max-w-2xl text-muted">Who trains, manages, scores and referees. Every fighter&apos;s team history is tracked with dates, so you can see how fighters did before, during and after a trainer.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => <Link key={k} href={`/people?role=${k}`} className={`chip ${tab === k ? "!border-gold/50 !text-gold" : ""}`}>{label}</Link>)}
      </div>
      {tab === "trainer" && <Trainers sort={sort} w={w} />}
      {tab === "manager" && <Managers w={w} />}
      {tab === "judge" && <Judges w={w} />}
      {tab === "referee" && <Referees w={w} />}
    </div>
  );
}

type W = Awaited<ReturnType<typeof getWorld>>;
const th = "py-2 text-left text-[11px] font-normal uppercase tracking-widest text-muted";

function Trainers({ sort, w }: { sort: string; w: W }) {
  const rows = trainerLeaderboard(w, 4);
  const key = { elo: (r: (typeof rows)[0]) => r.stable.avgRatingChange ?? -999, win: (r: (typeof rows)[0]) => r.stable.record.winRate, fighters: (r: (typeof rows)[0]) => r.stable.fighters, titles: (r: (typeof rows)[0]) => r.stable.titleWins }[sort] ?? ((r: (typeof rows)[0]) => r.stable.avgRatingChange ?? -999);
  rows.sort((a, b) => key(b) - key(a));
  return (
    <section>
      <SectionTitle eyebrow="Head trainers with 4+ fights on record" title="Trainer leaderboard" />
      <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="text-muted">Sort by</span>{[["elo", "Elo change"], ["win", "Win rate"], ["fighters", "Fighters"], ["titles", "Title wins"]].map(([k, l]) => <Link key={k} href={`/people?role=trainer&sort=${k}`} className={`chip ${sort === k ? "!border-gold/50 !text-gold" : ""}`}>{l}</Link>)}</div>
      <div className="card overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead><tr><th className={th}>#</th><th className={th}>Trainer</th><th className={th}>Fighters now / ever</th><th className={th}>Record together</th><th className={th}>Win%</th><th className={th}>Titles</th><th className={`${th} text-right`}>Avg Elo change</th></tr></thead>
          <tbody>
            {rows.slice(0, 60).map((r, i) => (
              <tr key={r.person.id} className="border-t border-line/60">
                <td className="py-2.5 font-display text-lg font-bold text-muted">{i + 1}</td>
                <td><Link href={`/people/${r.person.slug}`} className="hover:text-gold"><b>{r.person.name}</b> <span className="text-xs text-muted">{r.person.country ? flag(r.person.country) : ""}</span></Link></td>
                <td className="tabular">{r.stable.currentFighters} / {r.stable.fighters}</td>
                <td className="tabular">{r.stable.record.wins}-{r.stable.record.losses}-{r.stable.record.draws}</td>
                <td className="tabular">{Math.round(r.stable.record.winRate * 100)}%</td>
                <td className="tabular">{r.stable.titleWins}</td>
                <td className={`text-right tabular font-semibold ${(r.stable.avgRatingChange ?? 0) >= 0 ? "text-win" : "text-red"}`}>{r.stable.avgRatingChange === null ? "–" : `${r.stable.avgRatingChange >= 0 ? "+" : ""}${Math.round(r.stable.avgRatingChange)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Elo change is the average rating gain (or loss) a fighter had during each tenure. It reflects the fighter as much as the trainer, since trainers also pick up and lose fighters at different career stages. Treat it as a lead, not a verdict.</p>
    </section>
  );
}

function Managers({ w }: { w: W }) {
  const rows = [...w.people.values()].filter((p) => w.roles.get(p.id)?.has("manager")).map((p) => ({ p, s: personStable(w, p.id, ["manager"]) })).filter((r) => r.s.record.bouts >= 4).sort((a, b) => b.s.fighters - a.s.fighters);
  return (
    <section>
      <SectionTitle eyebrow="By number of fighters managed" title="Managers" />
      <div className="card overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Manager</th><th className={th}>Clients now / ever</th><th className={th}>Record</th><th className={th}>Win%</th><th className={`${th} text-right`}>Title wins</th></tr></thead>
          <tbody>{rows.slice(0, 50).map(({ p, s }) => (
            <tr key={p.id} className="border-t border-line/60"><td className="py-2.5"><Link href={`/people/${p.slug}`} className="hover:text-gold"><b>{p.name}</b></Link></td><td className="tabular">{s.currentFighters} / {s.fighters}</td><td className="tabular">{s.record.wins}-{s.record.losses}-{s.record.draws}</td><td className="tabular">{Math.round(s.record.winRate * 100)}%</td><td className="text-right tabular">{s.titleWins}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function Judges({ w }: { w: W }) {
  const { judges, leagueHomePickRate } = judgeStats(w);
  const disputes = scoringDisputes(w, 6);
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle eyebrow="How often each judge sides with the majority" title="Judges" />
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Judge</th><th className={th}>Cards</th><th className={th}>With majority</th><th className={th}>Dissents</th><th className={th}>Avg margin</th><th className={`${th} text-right`}>Picks the home fighter</th></tr></thead>
            <tbody>{judges.slice(0, 50).map((j) => {
              const diff = j.homePickRate === null ? null : j.homePickRate - leagueHomePickRate;
              return (
                <tr key={j.person.id} className="border-t border-line/60">
                  <td className="py-2.5"><Link href={`/people/${j.person.slug}`} className="hover:text-gold"><b>{j.person.name}</b></Link></td>
                  <td className="tabular">{j.cards}</td><td className="tabular">{Math.round(j.agreeWithMajority * 100)}%</td><td className="tabular">{j.dissents}</td><td className="tabular">{j.avgMargin.toFixed(1)}</td>
                  <td className="text-right tabular">{j.homePickRate === null ? "–" : <><span className={Math.abs(diff!) >= 0.06 && j.homeSamples >= 40 ? (diff! > 0 ? "font-semibold text-gold" : "font-semibold text-blue") : ""}>{Math.round(j.homePickRate * 100)}%</span><span className="ml-1.5 text-[10px] text-muted">n={j.homeSamples}</span></>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">“Picks the home fighter” counts decisive cards in bouts where exactly one fighter was a home national (league average {Math.round(leagueHomePickRate * 100)}%). With fewer than about 40 such cards the number is mostly noise.</p>
      </section>
      <section>
        <SectionTitle eyebrow="Widest disagreement between judges" title="Scoring disputes" />
        <div className="grid gap-3 md:grid-cols-2">
          {disputes.map((d) => (
            <Link key={d.bout.id} href={`/bouts/${d.bout.id}`} className="card card-hover p-4 text-sm">
              <div><b>{d.bout.redName}</b> <span className="text-muted">vs</span> <b>{d.bout.blueName}</b></div>
              <div className="mt-1 text-xs text-muted">{d.bout.eventName} · {d.bout.date}</div>
              <div className="mt-2 flex flex-wrap gap-2 tabular">{d.cards.map((c, i) => <span key={i} className="chip">{c.red}–{c.blue}</span>)}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Referees({ w }: { w: W }) {
  const { referees, leagueAvgStopRound } = refereeStats(w);
  return (
    <section>
      <SectionTitle eyebrow={`League average stoppage: round ${leagueAvgStopRound.toFixed(1)}`} title="Referees" />
      <div className="card overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Referee</th><th className={th}>Bouts</th><th className={th}>Stoppages</th><th className={th}>Stoppage rate</th><th className={th}>Early (R1–3)</th><th className={`${th} text-right`}>Avg stoppage round</th></tr></thead>
          <tbody>{referees.slice(0, 50).map((r) => (
            <tr key={r.person.id} className="border-t border-line/60"><td className="py-2.5"><Link href={`/people/${r.person.slug}`} className="hover:text-gold"><b>{r.person.name}</b></Link></td><td className="tabular">{r.bouts}</td><td className="tabular">{r.stoppages}</td><td className="tabular">{Math.round(r.stopRate * 100)}%</td><td className="tabular">{Math.round(r.earlyStopRate * 100)}%</td>
              <td className={`text-right tabular font-semibold ${r.avgStopRound !== null && r.stoppages >= 15 && r.avgStopRound < leagueAvgStopRound - 0.5 ? "text-gold" : ""}`}>{r.avgStopRound?.toFixed(2) ?? "–"}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
