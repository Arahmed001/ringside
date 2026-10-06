import type { BoxerFull } from "./types";
import type { World } from "./world";
import { memo } from "./memo";

export const ARCHETYPES = ["Knockout Artist", "Volume Boxer", "Technician", "Iron-Chin Brawler", "Counter-Puncher", "Journeyman", "Prospect"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export function archetype(b: BoxerFull): Archetype {
  if (b.bouts < 8) return "Prospect";
  if (b.winRate < 0.4) return "Journeyman";
  const finishLoss = b.losses ? b.koLosses / b.losses : 0;
  if (b.koRate >= 0.55) return "Knockout Artist";
  if (b.koRate >= 0.4 && finishLoss <= 0.35) return "Iron-Chin Brawler";
  if (b.koRate <= 0.3 && b.winRate >= 0.6) return "Technician";
  if (b.avgRounds >= 7 && b.koRate < 0.4) return "Volume Boxer";
  return "Counter-Puncher";
}

export const ARCH_COLOR: Record<Archetype, string> = {
  "Knockout Artist": "#ff4d4d",
  "Volume Boxer": "#4a9dff",
  "Technician": "#d9b25f",
  "Iron-Chin Brawler": "#ff8a3d",
  "Counter-Puncher": "#7ee0b4",
  Journeyman: "#6b6b78",
  Prospect: "#9a9aa6",
};

export function vector(b: BoxerFull, w: World): number[] {
  const hist = w.history.get(b.id) ?? [];
  return [
    b.koRate, b.winRate,
    b.age === null ? 0 : (b.age - 30) / 8, // an unknown age counts as typical, so it pulls toward no style
    b.avgRounds / 12,
    b.losses ? b.koLosses / b.losses : 0,
    b.stance === "Southpaw" ? 1 : 0,
    b.reachCm === null || b.heightCm === null ? 0 : (b.reachCm - b.heightCm) / 10,
    Math.min(1, b.bouts / 40),
    (b.rating - 1500) / 200,
    hist.length > 3 ? (hist[hist.length - 1].rating - hist[hist.length - 4].rating) / 60 : 0,
  ];
}

/**
 * The style vector of every fighter with five or more bouts, laid end to end, once per world. `similarTo` used to build all of them again for each
 * fighter page viewed (34,000 vectors at real size, about 40% of the page's time).
 */
const stylePool = (w: World) => memo(w, "stylePool", () => {
  const boxers = w.boxers.filter((o) => o.bouts >= 5);
  const dim = boxers.length ? vector(boxers[0], w).length : 0;
  const flat = new Float64Array(boxers.length * dim);
  boxers.forEach((o, i) => flat.set(vector(o, w), i * dim));
  return { boxers, flat, dim };
});

export function similarTo(b: BoxerFull, w: World, n = 5) {
  const vb = vector(b, w), { boxers, flat, dim } = stylePool(w);
  // the n nearest, in the order a stable sort by distance would give (ties in league order), without sorting everybody
  const best: { boxer: BoxerFull; d: number }[] = [];
  for (let i = 0; i < boxers.length && n > 0; i++) {
    const o = boxers[i];
    if (o.id === b.id) continue;
    let s = 0;
    for (let j = 0; j < dim; j++) s += (vb[j] - flat[i * dim + j]) ** 2;
    const d = Math.sqrt(s);
    if (best.length >= n && !(d < best[best.length - 1].d)) continue;
    let at = best.length;
    while (at > 0 && best[at - 1].d > d) at--;
    best.splice(at, 0, { boxer: o, d });
    if (best.length > n) best.pop();
  }
  return best.map((x) => ({ boxer: x.boxer, match: Math.max(0, Math.round(100 - x.d * 38)) }));
}

/** Projects all fighters to 2-D with PCA (power iteration) for the style map. */
export function styleMap(w: World) {
  const pool = w.boxers.filter((b) => b.bouts >= 8);
  if (pool.length === 0) return []; // a new or tiny league: nobody has eight fights yet
  const X = pool.map((b) => vector(b, w));
  const d = X[0].length, n = X.length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const cov = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) / n));
  const power = (m: number[][], skip?: number[]) => {
    let v = Array.from({ length: d }, (_, i) => 1 + i * 0.13);
    for (let it = 0; it < 120; it++) {
      let nv = m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      if (skip) { const dot = nv.reduce((s, x, j) => s + x * skip[j], 0); nv = nv.map((x, j) => x - dot * skip[j]); }
      const norm = Math.sqrt(nv.reduce((s, x) => s + x * x, 0)) || 1;
      v = nv.map((x) => x / norm);
    }
    return v;
  };
  const p1 = power(cov);
  const p2 = power(cov, p1);
  const pts = Z.map((r, i) => ({
    boxer: pool[i], x: r.reduce((s, v, j) => s + v * p1[j], 0), y: r.reduce((s, v, j) => s + v * p2[j], 0),
    arch: archetype(pool[i]),
  }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // one fighter, or fighters with identical styles, have no spread to scale by: put them in the middle rather than dividing by zero
  const at = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  return pts.map((p) => ({ ...p, x: at(p.x, x0, x1), y: at(p.y, y0, y1) }));
}

/**
 * The points the style map draws. The projection is computed over every fighter with eight or more bouts, but the
 * browser gets only the `perStyle` highest-rated of each style: at 16,500 fighters the full set was a 1.9 MB payload
 * and 16,500 SVG nodes. The demo league (800 plotted) is below the cap, so nothing is dropped there.
 */
export function styleMapSample(w: World, perStyle = 400) {
  const all = styleMap(w);
  const byStyle = new Map<string, typeof all>();
  for (const p of all) { const a = byStyle.get(p.arch); if (a) a.push(p); else byStyle.set(p.arch, [p]); }
  const points = [...byStyle.values()].flatMap((list) => (list.length > perStyle ? list.sort((x, y) => y.boxer.rating - x.boxer.rating).slice(0, perStyle) : list));
  return { points, total: all.length, perStyle };
}
