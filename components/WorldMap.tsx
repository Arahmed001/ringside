import world from "@/lib/geo/world-110m.json";

/**
 * A map drawn by this site: country outlines from Natural Earth (public domain) as plain SVG, shaded by a level the page gives each country, with a dot for each place the page wants
 * marked. No map library, no tiles, no request to any other site: a visitor's browser fetches nothing but this page. Each shaded country is a real link (reachable by keyboard and
 * announced with its own label), so the map is never the only way in: the pages also list everything in text.
 */
export interface Shade { level: 1 | 2 | 3 | 4 | 5; href: string; label: string }
export interface Dot { x: number; y: number; r: number; label: string; href?: string }
interface Country { iso: string; name: string; d: string; box: [number, number, number, number] }
const countries = world.countries as Country[];
export const mapWidth = world.width, mapHeight = world.height;

/** The box around a country's main land (and any dots), padded, as [x, y, width, height]; the whole world when the country has no outline. */
export function viewFor(iso: string | undefined, dots: Dot[] = []): [number, number, number, number] {
  const c = iso ? countries.find((k) => k.iso === iso) : undefined;
  const xs = dots.map((d) => d.x), ys = dots.map((d) => d.y);
  let [x0, y0, x1, y1] = c ? c.box : xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, mapWidth, mapHeight];
  if (c && xs.length) { x0 = Math.min(x0, ...xs); y0 = Math.min(y0, ...ys); x1 = Math.max(x1, ...xs); y1 = Math.max(y1, ...ys); }
  // a small country is shown no tighter than a 60-unit box, and the box is made 2:1 so it fills the frame
  let w = Math.max(x1 - x0, 60), h = Math.max(y1 - y0, 30);
  const pad = Math.max(w, h * 2) * 0.12; w += pad * 2; h += pad * 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w / h < 2) w = h * 2; else h = w / 2;
  w = Math.min(w, mapWidth); h = Math.min(h, mapHeight);
  return [Math.max(0, Math.min(cx - w / 2, mapWidth - w)), Math.max(0, Math.min(cy - h / 2, mapHeight - h)), w, h];
}

const LEVEL = ["fill-panel2", "fill-gold/15", "fill-gold/30", "fill-gold/50", "fill-gold/70", "fill-gold/90"];

export function WorldMap({ shades = {}, dots = [], view = [0, 0, mapWidth, mapHeight], label, current, className = "" }: {
  shades?: Record<string, Shade>; dots?: Dot[]; view?: [number, number, number, number]; label: string; /** the country being looked at: outlined */ current?: string; className?: string;
}) {
  const scale = view[2] / mapWidth; // dots and lines keep their size on screen as the map is zoomed in
  return (
    <svg viewBox={view.join(" ")} role="group" aria-label={label} className={`ltr-fixed block aspect-[2/1] w-full rounded-2xl border border-line bg-panel ${className}`}>
      {countries.map((c) => {
        const s = shades[c.iso];
        const path = <path d={c.d} className={`${LEVEL[s?.level ?? 0]} ${c.iso === current ? "stroke-gold" : "stroke-line"}`} strokeWidth={c.iso === current ? 1.5 : 0.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
        return s ? (
          <a key={c.iso} href={s.href} className="outline-none [&:focus-visible>path]:stroke-ink [&:hover>path]:stroke-ink"><title>{s.label}</title>{path}</a>
        ) : <g key={c.iso}>{path}</g>;
      })}
      {dots.map((d, i) => {
        const dot = <circle cx={d.x} cy={d.y} r={d.r * Math.max(scale, 0.12)} className="fill-ink stroke-bg" strokeWidth={0.8} vectorEffect="non-scaling-stroke"><title>{d.label}</title></circle>;
        return d.href ? <a key={i} href={d.href}>{dot}</a> : <g key={i}>{dot}</g>;
      })}
    </svg>
  );
}

/** The five shades with the ranges they stand for, drawn as a small key. */
export function MapKey({ steps, none }: { steps: { level: 1 | 2 | 3 | 4 | 5; text: string }[]; none: string }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm border border-line bg-panel2" aria-hidden />{none}</li>
      {steps.map((s) => <li key={s.level} className="flex items-center gap-1.5"><span className={`inline-block h-3 w-5 rounded-sm border border-line ${["", "bg-gold/15", "bg-gold/30", "bg-gold/50", "bg-gold/70", "bg-gold/90"][s.level]}`} aria-hidden />{s.text}</li>)}
    </ul>
  );
}
