import { Svg } from "./ChartI18n";
import type { Bin } from "@/lib/accountability";

/**
 * Reliability diagram: along the bottom, how confident the model was in its pick; up the side, how often that pick won.
 * A perfectly calibrated model sits on the diagonal. Dot area follows how many fights are in the bin. Labels arrive
 * already translated; the same numbers are in the table beside it, and in the chart's accessible name.
 */
export function CalibrationChart({ bins, label, desc, xLabel, yLabel, perfect }: { bins: Bin[]; label: string; desc: string; xLabel: string; yLabel: string; perfect: string }) {
  const W = 360, H = 340, L = 44, R = 12, T = 12, B = 44;
  const lo = 0.4, hi = 1;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const y = (v: number) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const shown = bins.filter((b) => b.n >= 10);
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} className="ltr-fixed w-full max-w-md" label={label} desc={desc}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity=".07" />
          <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} stroke="#fff" strokeOpacity=".07" />
          <text x={L - 6} y={y(v) + 5} textAnchor="end" fontSize="13.5" fill="#8d8d99">{Math.round(v * 100)}</text>
          <text x={x(v)} y={H - B + 16} textAnchor="middle" fontSize="13.5" fill="#8d8d99">{Math.round(v * 100)}</text>
        </g>
      ))}
      <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="#8d8d99" strokeDasharray="5 5" />
      <text x={x(0.66)} y={y(0.66) - 12} fontSize="13.5" fill="#8d8d99" transform={`rotate(-34 ${x(0.66)} ${y(0.66) - 12})`} textAnchor="middle">{perfect}</text>
      {shown.length > 1 && <polyline fill="none" stroke="#d9b25f" strokeOpacity=".6" strokeWidth="2" points={shown.map((b) => `${x(b.predicted).toFixed(1)},${y(Math.max(lo, b.observed)).toFixed(1)}`).join(" ")} />}
      {shown.map((b) => (
        <circle key={b.lo} cx={x(b.predicted)} cy={y(Math.max(lo, b.observed))} r={4 + 9 * Math.sqrt(b.n / maxN)} fill="#d9b25f" fillOpacity=".85" stroke="#09090b" strokeWidth="1.5" />
      ))}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="13.5" fill="var(--chart-grey)">{xLabel}</text>
      <text x={12} y={(T + H - B) / 2} textAnchor="middle" fontSize="13.5" fill="var(--chart-grey)" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{yLabel}</text>
    </Svg>
  );
}
