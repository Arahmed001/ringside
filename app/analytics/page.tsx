import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import * as A from "@/lib/analytics";
import { Heatmap, BarList, Donut, ColumnChart } from "@/components/charts";
import { Stat, SectionTitle } from "@/components/ui";
import { Headshot } from "@/components/Portrait";
import { fmtDate, pct, flag } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics" };

export default async function Analytics() {
  const w = await getWorld();
  const o = A.overview(w);
  const wc = A.byWeightClass(w);
  const ms = A.methodSplit(w);
  const years = A.boutsPerYear(w);
  const heat = A.finishHeat(w);
  const ups = A.biggestUpsets(w, 6);
  const countries = A.countryLeaders(w).slice(0, 8);
  const stance = A.stanceEdge(w);
  const reach = A.reachEdge(w);
  const streaks = A.longestStreaks(w, 6);
  const rounds = A.finishRoundHistogram(w);

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">Insights engine</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">Analytics</h1>
        <p className="mt-2 max-w-2xl text-muted">What {o.bouts.toLocaleString()} professional bouts actually say about the sport.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fighters" value={o.boxers} sub={`${o.countries} countries`} />
        <Stat label="Bouts" value={o.bouts.toLocaleString()} sub={`${o.events} events`} />
        <Stat label="Finish rate" value={pct(o.finishRate, 1)} sub="KO/TKO" />
        <Stat label="Reach edge" value={pct(reach.winPct, 1)} sub={`longer-armed wins (${reach.fights} fights, 5cm+ gap)`} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5"><div className="eyebrow mb-3">KO rate by division</div>
          <BarList rows={wc.map((r) => ({ label: r.weightClass, value: r.koRate, sub: `${r.bouts} bouts` }))} fmt={(v) => pct(v)} /></div>
        <div className="card p-5"><div className="eyebrow mb-3">How fights end</div>
          <Donut center={{ big: pct(o.finishRate), small: "FINISHED" }} parts={[
            { label: "KO", value: ms.KO, color: "#e5322d" }, { label: "TKO", value: ms.TKO, color: "#ff8a3d" }, { label: "Corner retirement", value: ms.RTD, color: "#c2410c" },
            { label: "Unanimous", value: ms.UD, color: "#d9b25f" }, { label: "Split", value: ms.SD, color: "#4a8cff" }, { label: "Majority", value: ms.MD, color: "#7ee0b4" },
            { label: "Technical decision", value: ms.TD, color: "#a78bfa" }, { label: "Disqualification", value: ms.DQ, color: "#f472b6" }, { label: "Draw", value: ms.DRAW + ms.TDRAW, color: "#8d8d99" },
          ]} />
          <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-panel2 p-3"><div className="text-xs text-muted">Southpaw win rate</div><div className="font-display text-2xl font-bold">{pct(stance.southpaw, 1)}</div></div>
            <div className="rounded-xl bg-panel2 p-3"><div className="text-xs text-muted">Orthodox win rate</div><div className="font-display text-2xl font-bold">{pct(stance.orthodox, 1)}</div></div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-1">When knockouts land</div>
        <p className="mb-4 text-sm text-muted">Share of each division’s finishes by round. Brighter = more stoppages. Heavier divisions end early; lighter ones grind.</p>
        <Heatmap rows={heat.map((h) => ({ label: h.weightClass, cells: h.cells, total: h.total }))} cols={Array.from({ length: 12 }, (_, i) => String(i + 1))} />
        <div className="mt-4 text-xs text-muted">Overall: round 1 accounts for {pct(rounds[0] / Math.max(1, rounds.reduce((a, b) => a + b, 0)))} of all stoppages.</div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5"><div className="eyebrow mb-3">Bouts per year <span className="text-red">· KO share</span></div>
          <ColumnChart data={years.map((y) => ({ label: y.year, a: y.total, b: y.ko }))} />
          <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{years[0]?.year}</span><span>{years[years.length - 1]?.year}</span></div></div>
        <div className="card p-5"><div className="eyebrow mb-3">Nations</div>
          <BarList rows={countries.map((c) => ({ label: `${flag(c.country)} ${c.country}`, value: c.wins, sub: `${c.boxers} fighters · ${pct(c.winRate)} win rate` }))} color="var(--gold)" /></div>
      </section>

      <section>
        <SectionTitle eyebrow="By rating gap" title="Biggest upsets" />
        <div className="grid gap-3 md:grid-cols-2">
          {ups.map((u) => {
            const win = w.byId.get(u.bout.winnerId!)!;
            const lose = w.byId.get(u.bout.winnerId === u.bout.redId ? u.bout.blueId : u.bout.redId)!;
            return (
              <Link key={u.bout.id} href={`/events/${u.bout.eventId}`} className="card card-hover flex items-center gap-3 p-4">
                <Headshot boxer={win} size={48} />
                <div className="min-w-0 flex-1 text-sm"><div><b>{win.name}</b> <span className="text-muted">beat</span> {lose.name}</div><div className="text-xs text-muted">{fmtDate(u.bout.date)} · {u.bout.method}</div></div>
                <div className="text-right"><div className="font-display text-2xl font-bold text-gold tabular">+{Math.round(u.gap)}</div><div className="text-[10px] uppercase tracking-widest text-muted">Elo gap</div></div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Records" title="Longest win streaks" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {streaks.map((s) => (
            <Link key={s.boxer.id} href={`/boxers/${s.boxer.slug}`} className="card card-hover flex items-center gap-3 p-3">
              <Headshot boxer={s.boxer} size={48} /><div className="flex-1 text-sm"><b>{s.boxer.name}</b><div className="text-xs text-muted">{s.boxer.weightClass}</div></div>
              <div className="font-display text-3xl font-bold text-win tabular">{s.len}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
