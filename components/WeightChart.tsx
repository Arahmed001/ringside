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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="ltr-fixed w-full" role="img" aria-label={t("Weigh-in weights over time")}>
      {ticks.map((k) => <g key={k}><line x1={pad + 22} x2={w - pad} y1={y(k)} y2={y(k)} stroke="#fff" strokeOpacity=".06" /><text x={pad + 18} y={y(k) + 3} textAnchor="end" fontSize="9" fill="#8d8d99">{k}</text></g>)}
      {limits && <polyline points={limits} fill="none" stroke="#ecebe6" strokeOpacity=".45" strokeDasharray="4 5" />}
      <polyline points={line("fightNight")} fill="none" stroke="#e5322d" strokeWidth="2" strokeLinejoin="round" />
      <polyline points={line("official")} fill="none" stroke="#d9b25f" strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={p.boutId}>
          <circle cx={x(i)} cy={y(p.official!)} r={p.made === false ? 5 : 2.6} fill={p.made === false ? "none" : "#d9b25f"} stroke={p.made === false ? "#e5322d" : "none"} strokeWidth="2" />
          <title>{tip(p)}</title>
        </g>
      ))}
      <g fontSize="10">
        <circle cx={pad + 28} cy={h - 6} r="3" fill="#d9b25f" /><text x={pad + 35} y={h - 3} fill="#8d8d99">{t("official")}</text>
        <circle cx={pad + 90} cy={h - 6} r="3" fill="#e5322d" /><text x={pad + 97} y={h - 3} fill="#8d8d99">{t("fight night")}</text>
        <line x1={pad + 165} x2={pad + 180} y1={h - 6} y2={h - 6} stroke="#ecebe6" strokeOpacity=".6" strokeDasharray="3 3" /><text x={pad + 185} y={h - 3} fill="#8d8d99">{t("limit")}</text>
      </g>
    </svg>
  );
}
