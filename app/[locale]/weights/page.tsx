import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { divisionWeights, fightNightEdge, missedWeights } from "@/lib/weights";
import { BarList } from "@/components/charts";
import { Headshot } from "@/components/Portrait";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/weights", title: t("Weigh-ins"),
  description: t("Official and fight-night weights, how often fighters miss the limit, how much they rehydrate, and what the weight gap does to the result."),
}));

export default async function Weights() {
  const t = await getT();
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
        <div className="eyebrow mb-2">{t("Scale to ring")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Weigh-ins")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Official weights the day before, fight-night weights after rehydration, and what the gap does to the result.")}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Weigh-ins")} value={all.toLocaleString("en-US")} sub={t("official weights on record")} />
        <Stat label={t("Missed weight")} value={pct(overallMiss, 1)} sub={t.n(total, "{n} miss · they won {rate}", "{n} misses · they won {rate}", { rate: pct(winRate) })} />
        <Stat label={t("Avg rehydration")} value={t("+{n} lb", { n: meanGain.toFixed(1) })} sub={t("scale to fight night")} />
        <Stat label={t("Heaviest edge")} value={edge[edge.length - 1] ? pct(edge[edge.length - 1].winRate) : "–"} sub={t("win rate when 8+ lb heavier")} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow mb-3">{t("Missed-weight rate by division")}</div>
          <BarList rows={limited.map((d) => ({ label: t(d.division), value: d.missRate, sub: t("limit {n} lb", { n: d.limitLb! }) }))} fmt={(v) => pct(v, 1)} />
        </div>
        <div className="card p-5">
          <div className="eyebrow mb-3">{t("Average rehydration (official → fight night)")}</div>
          <BarList rows={divs.map((d) => ({ label: t(d.division), value: d.avgGain, sub: t("{n} lb on fight night", { n: d.avgFightNight.toFixed(0) }) }))} fmt={(v) => t("+{n} lb", { n: v.toFixed(1) })} color="var(--gold)" />
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-1">{t("Does being heavier on fight night help?")}</div>
        <p className="mb-5 text-sm text-muted">{t("Win rate by how much heavier (or lighter) a fighter was than his opponent at the pre-fight check. The dashed line is 50%.")}</p>
        <div className="relative">
          <ul className="ltr-fixed grid gap-4 sm:grid-cols-7">
            {edge.map((e) => (
              <li key={e.label} className="flex flex-col items-center">
                <div className="relative flex h-40 w-full items-end justify-center">
                  <div className="absolute inset-x-0 border-t border-dashed border-white/25" style={{ bottom: `${(0.5 / maxEdge) * 100}%` }} />
                  <div className={`growy w-8 rounded-t-md ${e.winRate >= 0.5 ? "bg-win/80" : "bg-red/80"}`} style={{ height: `${(e.winRate / maxEdge) * 100}%` }} />
                </div>
                <div className="mt-2 font-display text-lg font-bold tabular">{pct(e.winRate)}</div>
                <div className="text-center text-xs leading-tight text-muted">{t(e.label)}</div>
                <div className="text-xs text-muted tabular">{t("n={n}", { n: e.n })}</div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-xs text-muted">{t("Heavier fighters are also usually the bigger, stronger natural fighters, so this is a correlation, not proof that rehydration wins fights. In this demo league the effect is built into the simulator.")}</p>
      </section>

      <section>
        <SectionTitle eyebrow={t("{n} on record", { n: total })} title={t("Recent missed weights")} />
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-sm" aria-label={t("Recent missed weights")}>
            <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th className="py-2">{t("Fighter")}</th><th>{t("Date")}</th><th>{t("Over the limit")}</th><th>{t("Opponent")}</th><th className="text-end">{t("Result")}</th></tr></thead>
            <tbody>{misses.map((m) => (
              <tr key={`${m.boutId}-${m.boxer.id}`} className="border-t border-line/60">
                <td className="py-2"><Link href={`/boxers/${m.boxer.slug}`} className="flex items-center gap-3"><Headshot boxer={m.boxer} size={28} /><b>{t.name(m.boxer.name)}</b></Link></td>
                <td className="text-muted tabular">{fmtDate(m.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</td>
                <td className="tabular text-red-ink">{t("+{n} lb", { n: m.over.toFixed(1) })} <span className="text-xs text-muted">{t("(limit {n})", { n: m.limitLb })}</span></td>
                <td className="text-muted">{t.name(m.opponent)}</td>
                <td className="text-end"><Link href={`/bouts/${m.boutId}`} className={`chip ${m.won ? "!border-win/40 !text-win" : m.won === false ? "!border-red/40 !text-red-ink" : ""}`}>{m.won === null ? t("Draw") : m.won ? t("Won") : t("Lost")}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
