import type { WeightPoint } from "@/lib/weights";
import { getT } from "@/lib/i18n/server";

/** Official weigh-in vs fight-night weight over a career, with the division limit as a dashed line. Misses are ringed in red. */
export async function WeightChart({ points, w = 900, h = 210 }: { points: WeightPoint[]; w?: number; h?: number }) {
  const t = await getT();
  const pts = points.filter((p) => p.official !== null);
  if (pts.length < 2) return <div className="grid h-full place-items-center text-sm text-muted">{t("Not enough weigh-ins on record")}</div>;
  const vals = pts.flatMap((p) => [p.official!, p.fightNight ?? p.official!, p.limit ?? p.official!]);
  const min = Math.min(...vals) - 2, max = Math.max(...vals) + 2, pad = 10;
  const x = (i: number) => pad + 22 + (i / (pts.length - 1)) * (w - pad * 2 - 22);
  const y = (v: number) => h - 22 - ((v - min) / (max - min)) * (h - 22 - pad);
  const line = (key: "official" | "fightNight") => pts.map((p, i) => `${x(i).toFixed(1)},${y((p[key] ?? p.official)!).toFixed(1)}`).join(" ");
  const limits = pts.map((p, i) => (p.limit !== null ? `${x(i).toFixed(1)},${y(p.limit).toFixed(1)}` : null)).filter(Boolean).join(" ");
  const ticks = [min, (min + max) / 2, max].map((v) => Math.round(v));
  const tip = (p: (typeof pts)[number]) => {
    const extra = [p.limit ? t("limit {n}", { n: p.limit }) : "", p.fightNight ? t("fight night {n}", { n: p.fightNight }) : "", p.made === false ? t("MISSED WEIGHT") : ""].filter(Boolean).join(", ");
    const base = t("{date}: scale {n} lb", { date: p.date, n: p.official! });
    return extra ? `${base} (${extra})` : base;
  };
  // Tick numbers and the legend are HTML, not SVG text: SVG text scales with the picture, and on a phone this 900-wide chart shrinks to about a third, which put its labels at 3 px.
  const legend = (dot: string) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />;
  return (
    <div className="ltr-fixed">
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-1">
        <div aria-hidden className="relative">
          {ticks.map((k) => <span key={k} className="tabular absolute end-0 -translate-y-1/2 text-xs text-muted" style={{ top: `${(y(k) / h) * 100}%` }}>{k}</span>)}
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={t("Weigh-in weights over time")}>
          {ticks.map((k) => <line key={k} x1={pad + 22} x2={w - pad} y1={y(k)} y2={y(k)} stroke="#fff" strokeOpacity=".06" />)}
          {limits && <polyline points={limits} fill="none" stroke="#ecebe6" strokeOpacity=".45" strokeDasharray="4 5" />}
          <polyline points={line("fightNight")} fill="none" stroke="#e5322d" strokeWidth="2" strokeLinejoin="round" />
          <polyline points={line("official")} fill="none" stroke="#d9b25f" strokeWidth="2" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <g key={p.boutId}>
              <circle cx={x(i)} cy={y(p.official!)} r={p.made === false ? 5 : 2.6} fill={p.made === false ? "none" : "#d9b25f"} stroke={p.made === false ? "#e5322d" : "none"} strokeWidth="2" />
              <title>{tip(p)}</title>
            </g>
          ))}
        </svg>
      </div>
      <div aria-hidden className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 ps-8 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5" dir="auto">{legend("#d9b25f")}{t("official")}</span>
        <span className="inline-flex items-center gap-1.5" dir="auto">{legend("#e5322d")}{t("fight night")}</span>
        <span className="inline-flex items-center gap-1.5" dir="auto"><span className="inline-block w-4 border-t border-dashed border-ink/60" />{t("limit")}</span>
      </div>
    </div>
  );
}
