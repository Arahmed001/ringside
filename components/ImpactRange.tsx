import { getT } from "@/lib/i18n/server";
import type { Impact } from "@/lib/trainer-impact";

const SPAN = 150; // the scale runs from -150 to +150 Elo

/** A trainer's estimated effect as a point with its 95% range on a line from -150 to +150 Elo; the middle is the average trainer. */
export async function ImpactRange({ impact, height = 28 }: { impact: Pick<Impact, "effect" | "se">; height?: number }) {
  const t = await getT();
  const x = (v: number) => 50 + (Math.max(-SPAN, Math.min(SPAN, v)) / SPAN) * 50;
  const lo = impact.effect - 1.96 * impact.se, hi = impact.effect + 1.96 * impact.se;
  const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`;
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="ltr-fixed w-full" style={{ height }} role="img"
      aria-label={t("Estimated effect {effect} Elo, 95% range {lo} to {hi}", { effect: sign(impact.effect), lo: sign(lo), hi: sign(hi) })}>
      <line x1="0" x2="100" y1="5" y2="5" stroke="#fff" strokeOpacity=".12" strokeWidth=".4" />
      <line x1="50" x2="50" y1="1" y2="9" stroke="#fff" strokeOpacity=".35" strokeWidth=".5" />
      <line x1={x(lo)} x2={x(hi)} y1="5" y2="5" stroke="#d9b25f" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={x(impact.effect)} cy="5" r="1.7" fill="#d9b25f" />
    </svg>
  );
}
