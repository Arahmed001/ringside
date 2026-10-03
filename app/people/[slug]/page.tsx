import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorld } from "@/lib/world";
import { personStable } from "@/lib/team";
import { judgeStats, refereeStats } from "@/lib/officials";
import { TenureTable } from "@/components/TenureTable";
import { TeamTimeline } from "@/components/TeamTimeline";
import { SectionTitle, Stat } from "@/components/ui";
import { flag, fmtDate, methodLabel } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = (await getWorld()).peopleBySlug.get((await params).slug);
  return { title: p ? p.name : "Person" };
}

const ROLE_NAME: Record<string, string> = { trainer: "Trainer", manager: "Manager", judge: "Judge", referee: "Referee" };

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
    ? [...head.tenures].sort((a, b) => (a.stint.start ?? "").localeCompare(b.stint.start ?? "")).slice(-16).map((t) => ({
        label: t.boxer.name, color: "#d9b25f",
        segments: [{ from: t.stint.start, to: t.stint.end, label: `${t.record.wins}-${t.record.losses}-${t.record.draws}`, sub: t.ratingChange === null ? undefined : `${t.ratingChange >= 0 ? "+" : ""}${Math.round(t.ratingChange)} Elo`, href: `/boxers/${t.boxer.slug}`, current: t.current }],
      }))
    : [];

  // recent bouts for officials
  const recentBouts = (kind: "judge" | "referee") => {
    const out: { id: number; label: string; date: string; result: string; detail: string }[] = [];
    for (const b of [...w.bouts].reverse()) {
      if (b.upcoming) continue;
      const o = (w.officialsByBout.get(b.id) ?? []).find((x) => x.personId === p.id && x.role === kind);
      if (!o) continue;
      const card = kind === "judge" ? (w.scorecardsByBout.get(b.id) ?? []).find((c) => c.judgeId === p.id) : null;
      out.push({ id: b.id, label: `${b.redName} vs ${b.blueName}`, date: b.date, result: methodLabel(b.method, b.endRound), detail: card ? `${card.red}–${card.blue}` : "" });
      if (out.length >= 12) break;
    }
    return out;
  };

  return (
    <div className="space-y-10">
      <section className="rise">
        <div className="flex flex-wrap items-center gap-2">{roles.map((r) => <span key={r} className="chip !border-gold/40 !text-gold">{ROLE_NAME[r] ?? r}</span>)}</div>
        <h1 className="mt-3 font-display text-6xl font-extrabold uppercase leading-[.95]">{p.name}</h1>
        {p.country && <div className="mt-2 text-muted">{flag(p.country)} {p.country}</div>}
      </section>

      {head && (
        <section className="space-y-5">
          <SectionTitle eyebrow="As head trainer" title="Stable" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Fighters" value={head.fighters} sub={`${head.currentFighters} current`} />
            <Stat label="Record together" value={`${head.record.wins}-${head.record.losses}-${head.record.draws}`} sub={`${Math.round(head.record.winRate * 100)}% wins · ${Math.round(head.record.koRate * 100)}% KO`} />
            <Stat label="Title wins" value={head.titleWins} />
            <Stat label="Avg Elo change" value={head.avgRatingChange === null ? "–" : `${head.avgRatingChange >= 0 ? "+" : ""}${Math.round(head.avgRatingChange)}`} sub="per tenure" />
          </div>
          {timelineRows.length > 0 && <div className="card p-5"><div className="eyebrow mb-3">Fighters over time{head && head.tenures.length > 16 ? ` (latest 16 of ${head.tenures.length})` : ""}</div><TeamTimeline rows={timelineRows} today={w.today} /></div>}
          <div className="card p-5"><TenureTable tenures={head.tenures} /></div>
          {trainer && trainer.tenures.length > head.tenures.length && <p className="text-xs text-muted">Also worked in other corner roles (assistant, strength and conditioning) with {trainer.fighters - head.fighters} further fighters.</p>}
        </section>
      )}

      {manager && (
        <section className="space-y-5">
          <SectionTitle eyebrow="As manager" title="Clients" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Clients" value={manager.fighters} sub={`${manager.currentFighters} current`} />
            <Stat label="Record" value={`${manager.record.wins}-${manager.record.losses}-${manager.record.draws}`} sub={`${Math.round(manager.record.winRate * 100)}% wins`} />
            <Stat label="Title wins" value={manager.titleWins} />
          </div>
          <div className="card p-5"><TenureTable tenures={manager.tenures} /></div>
        </section>
      )}

      {myJudge && judge && (
        <section className="space-y-5">
          <SectionTitle eyebrow="As judge" title="Scoring record" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Cards scored" value={myJudge.cards} />
            <Stat label="With majority" value={`${Math.round(myJudge.agreeWithMajority * 100)}%`} sub={`${myJudge.dissents} dissents`} />
            <Stat label="Avg margin" value={myJudge.avgMargin.toFixed(1)} sub="points" />
            <Stat label="Picks home fighter" value={myJudge.homePickRate === null ? "–" : `${Math.round(myJudge.homePickRate * 100)}%`} sub={`league ${Math.round(judge.leagueHomePickRate * 100)}% · n=${myJudge.homeSamples}`} />
          </div>
          <div className="card overflow-x-auto p-5">
            <table className="w-full text-sm"><tbody>{recentBouts("judge").map((b) => (
              <tr key={b.id} className="border-t border-line/60 first:border-0"><td className="py-2 text-muted tabular">{fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" })}</td><td><Link href={`/bouts/${b.id}`} className="hover:text-gold">{b.label}</Link></td><td className="tabular text-muted">{b.result}</td><td className="text-right tabular font-semibold">{b.detail}</td></tr>
            ))}</tbody></table>
          </div>
        </section>
      )}

      {myRef && ref && (
        <section className="space-y-5">
          <SectionTitle eyebrow="As referee" title="Officiating record" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Bouts" value={myRef.bouts} />
            <Stat label="Stoppages" value={myRef.stoppages} sub={`${Math.round(myRef.stopRate * 100)}% of bouts`} />
            <Stat label="Avg stoppage round" value={myRef.avgStopRound?.toFixed(2) ?? "–"} sub={`league ${ref.leagueAvgStopRound.toFixed(2)}`} />
            <Stat label="Early stoppages" value={`${Math.round(myRef.earlyStopRate * 100)}%`} sub="rounds 1–3" />
          </div>
          <div className="card overflow-x-auto p-5">
            <table className="w-full text-sm"><tbody>{recentBouts("referee").map((b) => (
              <tr key={b.id} className="border-t border-line/60 first:border-0"><td className="py-2 text-muted tabular">{fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" })}</td><td><Link href={`/bouts/${b.id}`} className="hover:text-gold">{b.label}</Link></td><td className="text-right tabular text-muted">{b.result}</td></tr>
            ))}</tbody></table>
          </div>
        </section>
      )}
    </div>
  );
}
