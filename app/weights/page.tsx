import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import { divisionWeights, fightNightEdge, missedWeights } from "@/lib/weights";
import { BarList } from "@/components/charts";
import { Headshot } from "@/components/Portrait";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Weigh-ins" };

export default async function Weights() {
  const w = await getWorld();
  const divs = divisionWeights(w).filter((d) => d.n > 0);
  const edge = fightNightEdge(w);
  const { misses, total, winRate } = missedWeights(w, 12);
  const all = divs.reduce((s, d) => s + d.n, 0);
  const limited = divs.filter((d) => d.limitLb !== null);
  const overallMiss = limited.reduce((s, d) => s + d.missRate * d.n, 0) / Math.max(1, limited.reduce((s, d) => s + d.n, 0));
  const meanGain = divs.reduce((s, d) => s + d.avgGain * d.n, 0) / Math.max(1, all);
  const maxEdge = Math.max(0.6, ...edge.map((e) => e.winRate));

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">Scale to ring</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">Weigh-ins</h1>
        <p className="mt-2 max-w-2xl text-muted">Official weights the day before, fight-night weights after rehydration, and what the gap does to the result.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Weigh-ins" value={all.toLocaleString()} sub="official weights on record" />
        <Stat label="Missed weight" value={pct(overallMiss, 1)} sub={`${total} misses · they won ${pct(winRate)}`} />
        <Stat label="Avg rehydration" value={`+${meanGain.toFixed(1)} lb`} sub="scale to fight night" />
        <Stat label="Heaviest edge" value={edge[edge.length - 1] ? pct(edge[edge.length - 1].winRate) : "–"} sub="win rate when 8+ lb heavier" />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow mb-3">Missed-weight rate by division</div>
          <BarList rows={limited.map((d) => ({ label: d.division, value: d.missRate, sub: `limit ${d.limitLb} lb` }))} fmt={(v) => pct(v, 1)} />
        </div>
        <div className="card p-5">
          <div className="eyebrow mb-3">Average rehydration (official → fight night)</div>
          <BarList rows={divs.map((d) => ({ label: d.division, value: d.avgGain, sub: `${d.avgFightNight.toFixed(0)} lb on fight night` }))} fmt={(v) => `+${v.toFixed(1)} lb`} color="var(--gold)" />
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-1">Does being heavier on fight night help?</div>
        <p className="mb-5 text-sm text-muted">Win rate by how much heavier (or lighter) a fighter was than his opponent at the pre-fight check. The dashed line is 50%.</p>
        <div className="relative">
          <ul className="grid gap-4 sm:grid-cols-7">
            {edge.map((e) => (
              <li key={e.label} className="flex flex-col items-center">
                <div className="relative flex h-40 w-full items-end justify-center">
                  <div className="absolute inset-x-0 border-t border-dashed border-white/25" style={{ bottom: `${(0.5 / maxEdge) * 100}%` }} />
                  <div className={`growy w-8 rounded-t-md ${e.winRate >= 0.5 ? "bg-win/80" : "bg-red/80"}`} style={{ height: `${(e.winRate / maxEdge) * 100}%` }} />
                </div>
                <div className="mt-2 font-display text-lg font-bold tabular">{pct(e.winRate)}</div>
                <div className="text-center text-[10px] leading-tight text-muted">{e.label}</div>
                <div className="text-[10px] text-muted/70 tabular">n={e.n}</div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-xs text-muted">Heavier fighters are also usually the bigger, stronger natural fighters, so this is a correlation, not proof that rehydration wins fights. In this demo league the effect is built into the simulator.</p>
      </section>

      <section>
        <SectionTitle eyebrow={`${total} on record`} title="Recent missed weights" />
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted"><th className="py-2">Fighter</th><th>Date</th><th>Over the limit</th><th>Opponent</th><th className="text-right">Result</th></tr></thead>
            <tbody>{misses.map((m) => (
              <tr key={`${m.boutId}-${m.boxer.id}`} className="border-t border-line/60">
                <td className="py-2"><Link href={`/boxers/${m.boxer.slug}`} className="flex items-center gap-3"><Headshot boxer={m.boxer} size={28} /><b>{m.boxer.name}</b></Link></td>
                <td className="text-muted tabular">{fmtDate(m.date, { month: "short", day: "numeric", year: "numeric" })}</td>
                <td className="tabular text-red">+{m.over.toFixed(1)} lb <span className="text-xs text-muted">(limit {m.limitLb})</span></td>
                <td className="text-muted">{m.opponent}</td>
                <td className="text-right"><Link href={`/bouts/${m.boutId}`} className={`chip ${m.won ? "!border-win/40 !text-win" : m.won === false ? "!border-red/40 !text-red" : ""}`}>{m.won === null ? "Draw" : m.won ? "Won" : "Lost"}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
