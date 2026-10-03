import { ARCH_COLOR } from "@/lib/style";
import { msg } from "@/lib/i18n/t";
import { HeatCell, Svg, Tx } from "./ChartI18n";

export { ProbBar } from "./ChartI18n";

export function Sparkline({ data, w = 560, h = 160, color = "#e5322d", labels }: { data: number[]; w?: number; h?: number; color?: string; labels?: [string, string] }) {
  if (data.length < 2) return <div className="grid h-full place-items-center text-sm text-muted"><Tx k={msg("Not enough fights yet")} /></div>;
  const pad = 8, min = Math.min(...data) - 10, max = Math.max(...data) + 10;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2 - 14);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${x(0)},${h - pad} L${pts.join(" L")} L${x(data.length - 1)},${h - pad}Z`;
  const id = `sp${Math.abs(Math.round(data[0] * 7 + data.length))}`;
  const peak = data.indexOf(Math.max(...data));
  return (
    <Svg viewBox={`0 0 ${w} ${h}`} className="ltr-fixed w-full" label={msg("Rating over time")}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".4" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <line x1={pad} x2={w - pad} y1={y(1500)} y2={y(1500)} stroke="#fff" strokeOpacity=".12" strokeDasharray="4 6" />
      <path d={area} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" className="draw" style={{ ["--len" as string]: 4000 }} />
      <circle cx={x(peak)} cy={y(data[peak])} r="4.5" fill="#d9b25f" />
      <text x={x(peak) > w - 70 ? x(peak) - 8 : x(peak)} y={y(data[peak]) - 9} textAnchor={x(peak) > w - 70 ? "end" : "middle"} fontSize="11" fill="#d9b25f"><Tx k={msg("peak {n}")} vars={{ n: Math.round(data[peak]) }} /></text>
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="4" fill={color} />
      {labels && <><text x={pad} y={h - 0} fontSize="10" fill="#8d8d99">{labels[0]}</text><text x={w - pad} y={h - 0} textAnchor="end" fontSize="10" fill="#8d8d99">{labels[1]}</text></>}
    </Svg>
  );
}

export function BarList({ rows, max, fmt = (v: number) => String(v), color = "var(--red)" }: { rows: { label: string; value: number; sub?: string }[]; max?: number; fmt?: (v: number) => string; color?: string }) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between text-xs"><span className="text-ink/90">{r.label}</span><span className="tabular text-muted">{fmt(r.value)}{r.sub ? ` · ${r.sub}` : ""}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="growx h-full rounded-full" style={{ width: `${(r.value / m) * 100}%`, background: color, animationDelay: `${i * 40}ms` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ parts, size = 170, center }: { parts: { label: string; value: number; color: string }[]; size?: number; center?: { big: string; small: string } }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 60, c = 2 * Math.PI * r;
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((s, q) => s + (q.value / total) * c, 0));
  return (
    <div className="flex flex-wrap items-center gap-6">
      <Svg viewBox="0 0 160 160" width={size} height={size} label={msg("Distribution")}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="#1a1a21" strokeWidth="20" />
        {parts.map((p, i) => {
          const len = (p.value / total) * c;
          const off = offsets[i];
          return <circle key={p.label} cx="80" cy="80" r={r} fill="none" stroke={p.color} strokeWidth="20" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 80 80)" />;
        })}
        {center && <><text x="80" y="82" textAnchor="middle" fontSize="26" fontWeight="800" fill="#ecebe6" style={{ fontFamily: "var(--font-display)" }}>{center.big}</text><text x="80" y="98" textAnchor="middle" fontSize="9" fill="#8d8d99">{center.small}</text></>}
      </Svg>
      <ul className="space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} /><span className="text-ink/90">{p.label}</span><span className="tabular text-muted">{((p.value / total) * 100).toFixed(1)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

export function ColumnChart({ data, h = 170 }: { data: { label: string; a: number; b?: number }[]; h?: number }) {
  const max = Math.max(...data.map((d) => d.a), 1);
  const bw = 100 / data.length;
  return (
    <Svg viewBox={`0 0 100 ${h / 3.2}`} preserveAspectRatio="none" className="ltr-fixed w-full" style={{ height: h }} label={msg("Column chart")}>
      {data.map((d, i) => {
        const hh = (d.a / max) * (h / 3.2 - 8);
        const kh = ((d.b ?? 0) / max) * (h / 3.2 - 8);
        return (
          <g key={d.label}>
            <rect x={i * bw + bw * 0.14} y={h / 3.2 - hh} width={bw * 0.72} height={hh} rx=".6" fill="#26262f" />
            <rect x={i * bw + bw * 0.14} y={h / 3.2 - kh} width={bw * 0.72} height={kh} rx=".6" fill="#e5322d" />
          </g>
        );
      })}
    </Svg>
  );
}

export function Heatmap({ rows, cols }: { rows: { label: string; cells: number[]; total: number }[]; cols: string[] }) {
  const max = Math.max(...rows.flatMap((r) => r.cells), 0.01);
  return (
    <div className="overflow-x-auto">
      <table className="ltr-fixed w-full border-separate border-spacing-[3px] text-[10px]">
        <thead><tr><th />{cols.map((c) => <th key={c} className="font-normal text-muted">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="whitespace-nowrap pe-2 text-end text-xs text-muted">{r.label}</td>
              {r.cells.map((v, i) => <HeatCell key={i} label={r.label} round={i + 1} pct={Math.round(v * 100)} bg={v === 0 ? "#15151b" : `rgba(229,50,45,${0.12 + (v / max) * 0.88})`} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Radar({ axes, color = "#d9b25f", size = 220 }: { axes: { label: string; v: number }[]; color?: string; size?: number }) {
  const n = axes.length, cx = 110, cy = 110, R = 76;
  const pt = (i: number, k: number) => [cx + Math.sin((i / n) * 2 * Math.PI) * R * k, cy - Math.cos((i / n) * 2 * Math.PI) * R * k];
  const poly = (k: (i: number) => number) => axes.map((_, i) => pt(i, k(i)).join(",")).join(" ");
  return (
    <Svg viewBox="0 0 220 220" width={size} height={size} label={msg("Attribute radar")}>
      {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} points={poly(() => k)} fill="none" stroke="#fff" strokeOpacity=".09" />)}
      {axes.map((_, i) => <line key={i} x1={cx} y1={cy} x2={pt(i, 1)[0]} y2={pt(i, 1)[1]} stroke="#fff" strokeOpacity=".09" />)}
      <polygon points={poly((i) => Math.max(0.04, Math.min(1, axes[i].v)))} fill={color} fillOpacity=".25" stroke={color} strokeWidth="2" />
      {axes.map((a, i) => { const [x, y] = pt(i, 1.2); return <text key={a.label} x={x} y={y + 3} textAnchor="middle" fontSize="9.5" fill="#8d8d99">{a.label}</text>; })}
    </Svg>
  );
}

export const archColor = (a: keyof typeof ARCH_COLOR) => ARCH_COLOR[a];
