import type { World } from "./world";
import { WEIGHT_CLASSES } from "./types";

const done = (w: World) => w.bouts.filter((b) => !b.upcoming && b.method && b.method !== "NC");
const isKO = (m: string | null) => m === "KO" || m === "TKO";

export function overview(w: World) {
  const d = done(w);
  return {
    boxers: w.boxers.length,
    bouts: d.length,
    events: w.events.filter((e) => !e.upcoming).length,
    countries: new Set(w.boxers.map((b) => b.country)).size,
    finishRate: d.filter((b) => isKO(b.method)).length / d.length,
  };
}

export function byWeightClass(w: World) {
  const d = done(w);
  return WEIGHT_CLASSES.map((wc) => {
    const l = d.filter((b) => b.weightClass === wc);
    const ko = l.filter((b) => isKO(b.method)).length;
    return { weightClass: wc, bouts: l.length, koRate: l.length ? ko / l.length : 0 };
  });
}

export function methodSplit(w: World) {
  const d = done(w);
  const c = { KO: 0, TKO: 0, UD: 0, SD: 0, MD: 0, DRAW: 0 } as Record<string, number>;
  for (const b of d) if (b.method) c[b.method] = (c[b.method] ?? 0) + 1;
  return c;
}

export function boutsPerYear(w: World) {
  const m = new Map<string, { total: number; ko: number }>();
  for (const b of done(w)) {
    const y = b.date.slice(0, 4);
    const r = m.get(y) ?? { total: 0, ko: 0 };
    r.total++; if (isKO(b.method)) r.ko++;
    m.set(y, r);
  }
  return [...m].sort().map(([year, v]) => ({ year, ...v }));
}

export function finishRoundHistogram(w: World) {
  const counts = Array(12).fill(0) as number[];
  for (const b of done(w)) if (isKO(b.method) && b.endRound) counts[b.endRound - 1]++;
  return counts;
}

/** Heatmap: weight class × round (share of that class's finishes). */
export function finishHeat(w: World) {
  return WEIGHT_CLASSES.map((wc) => {
    const row = Array(12).fill(0) as number[];
    let total = 0;
    for (const b of done(w)) if (b.weightClass === wc && isKO(b.method) && b.endRound) { row[b.endRound - 1]++; total++; }
    return { weightClass: wc, cells: row.map((v) => (total ? v / total : 0)), total };
  });
}

export function biggestUpsets(w: World, n = 8) {
  return done(w)
    .filter((b) => b.winnerId)
    .map((b) => {
      const pre = w.boutPre.get(b.id);
      if (!pre) return null;
      const winnerRating = b.winnerId === b.redId ? pre.red : pre.blue;
      const loserRating = b.winnerId === b.redId ? pre.blue : pre.red;
      return { bout: b, gap: loserRating - winnerRating, winnerRating, loserRating };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.winnerRating !== 1500 && x.loserRating !== 1500)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, n);
}

export function countryLeaders(w: World) {
  const m = new Map<string, { boxers: number; wins: number; bouts: number }>();
  for (const b of w.boxers) {
    const r = m.get(b.country) ?? { boxers: 0, wins: 0, bouts: 0 };
    r.boxers++; r.wins += b.wins; r.bouts += b.bouts;
    m.set(b.country, r);
  }
  return [...m].map(([country, v]) => ({ country, ...v, winRate: v.bouts ? v.wins / v.bouts : 0 })).sort((a, b) => b.wins - a.wins);
}

export function stanceEdge(w: World) {
  let sw = 0, swW = 0, or = 0, orW = 0;
  for (const b of w.boxers) {
    if (b.stance === "Southpaw") { sw += b.bouts; swW += b.wins; } else { or += b.bouts; orW += b.wins; }
  }
  return { southpaw: sw ? swW / sw : 0, orthodox: or ? orW / or : 0 };
}

export function reachEdge(w: World) {
  let longer = 0, longerWins = 0;
  for (const b of done(w)) {
    if (!b.winnerId) continue;
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    if (Math.abs(r.reachCm - u.reachCm) < 5) continue;
    const longerId = r.reachCm > u.reachCm ? r.id : u.id;
    longer++; if (b.winnerId === longerId) longerWins++;
  }
  return { fights: longer, winPct: longer ? longerWins / longer : 0 };
}

export function longestStreaks(w: World, n = 6) {
  const out: { boxerId: number; len: number }[] = [];
  for (const b of w.boxers) {
    let cur = 0, best = 0;
    for (const x of w.boutsByBoxer.get(b.id) ?? []) {
      if (x.upcoming || !x.method) continue;
      if (x.winnerId === b.id) { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    out.push({ boxerId: b.id, len: best });
  }
  return out.sort((a, b) => b.len - a.len).slice(0, n).map((x) => ({ boxer: w.byId.get(x.boxerId)!, len: x.len }));
}
