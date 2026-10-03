import type { World } from "./world";
import type { BoutRow } from "./types";
import { WEIGHT_CLASSES } from "./types";
import { METHODS, countsInRecord, isStoppage } from "./methods";
import { memo } from "./memo";

/** Completed bouts that count toward records, chronological. Shared by every aggregate below. */
const done = (w: World): BoutRow[] => memo(w, "done", () => w.bouts.filter((b) => !b.upcoming && countsInRecord(b.method)));
const isKO = isStoppage; // corner retirements count as knockouts, as in fighters' records

export const overview = (w: World) => memo(w, "overview", () => {
  const d = done(w);
  return {
    boxers: w.boxers.length,
    bouts: d.length,
    events: w.events.filter((e) => !e.upcoming).length,
    countries: new Set(w.boxers.map((b) => b.country)).size,
    finishRate: d.length ? d.filter((b) => isKO(b.method)).length / d.length : 0,
  };
});

export const byWeightClass = (w: World) => memo(w, "byWeightClass", () => {
  const tally = new Map(WEIGHT_CLASSES.map((wc) => [wc as string, { bouts: 0, ko: 0 }]));
  for (const b of done(w)) {
    const t = tally.get(b.weightClass);
    if (t) { t.bouts++; if (isKO(b.method)) t.ko++; }
  }
  return WEIGHT_CLASSES.map((wc) => { const t = tally.get(wc)!; return { weightClass: wc, bouts: t.bouts, koRate: t.bouts ? t.ko / t.bouts : 0 }; });
});

export const methodSplit = (w: World) => memo(w, "methodSplit", () => {
  const c = Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<string, number>;
  for (const b of done(w)) if (b.method) c[b.method] = (c[b.method] ?? 0) + 1;
  return c;
});

export const boutsPerYear = (w: World) => memo(w, "boutsPerYear", () => {
  const m = new Map<string, { total: number; ko: number }>();
  for (const b of done(w)) {
    const y = b.date.slice(0, 4);
    const r = m.get(y) ?? { total: 0, ko: 0 };
    r.total++; if (isKO(b.method)) r.ko++;
    m.set(y, r);
  }
  return [...m].sort().map(([year, v]) => ({ year, ...v }));
});

export const finishRoundHistogram = (w: World) => memo(w, "finishRoundHistogram", () => {
  const counts = Array(12).fill(0) as number[];
  for (const b of done(w)) if (isKO(b.method) && b.endRound) counts[b.endRound - 1]++;
  return counts;
});

/** Heatmap: weight class × round (share of that class's finishes). */
export const finishHeat = (w: World) => memo(w, "finishHeat", () => {
  const rows = new Map(WEIGHT_CLASSES.map((wc) => [wc as string, { row: Array(12).fill(0) as number[], total: 0 }]));
  for (const b of done(w)) {
    const r = isKO(b.method) && b.endRound ? rows.get(b.weightClass) : undefined;
    if (r) { r.row[b.endRound! - 1]++; r.total++; }
  }
  return WEIGHT_CLASSES.map((wc) => { const { row, total } = rows.get(wc)!; return { weightClass: wc, cells: row.map((v) => (total ? v / total : 0)), total }; });
});

/** The largest rating gaps overcome by a winner (pre-fight Elo). `since` limits it to bouts on or after that date. */
export const biggestUpsets = (w: World, n = 8, since?: string) => memo(w, `biggestUpsets:${n}:${since ?? ""}`, () =>
  done(w)
    .filter((b) => b.winnerId && (!since || b.date >= since))
    .map((b) => {
      const pre = w.boutPre.get(b.id);
      if (!pre) return null;
      const winnerRating = b.winnerId === b.redId ? pre.red : pre.blue;
      const loserRating = b.winnerId === b.redId ? pre.blue : pre.red;
      return { bout: b, gap: loserRating - winnerRating, winnerRating, loserRating };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.winnerRating !== 1500 && x.loserRating !== 1500)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, n));

export const countryLeaders = (w: World) => memo(w, "countryLeaders", () => {
  const m = new Map<string, { boxers: number; wins: number; bouts: number }>();
  for (const b of w.boxers) {
    const r = m.get(b.country) ?? { boxers: 0, wins: 0, bouts: 0 };
    r.boxers++; r.wins += b.wins; r.bouts += b.bouts;
    m.set(b.country, r);
  }
  return [...m].map(([country, v]) => ({ country, ...v, winRate: v.bouts ? v.wins / v.bouts : 0 })).sort((a, b) => b.wins - a.wins);
});

export const stanceEdge = (w: World) => memo(w, "stanceEdge", () => {
  let sw = 0, swW = 0, or = 0, orW = 0;
  for (const b of w.boxers) {
    if (b.stance === "Southpaw") { sw += b.bouts; swW += b.wins; } else { or += b.bouts; orW += b.wins; }
  }
  return { southpaw: sw ? swW / sw : 0, orthodox: or ? orW / or : 0 };
});

export const reachEdge = (w: World) => memo(w, "reachEdge", () => {
  let longer = 0, longerWins = 0;
  for (const b of done(w)) {
    if (!b.winnerId) continue;
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    if (Math.abs(r.reachCm - u.reachCm) < 5) continue;
    const longerId = r.reachCm > u.reachCm ? r.id : u.id;
    longer++; if (b.winnerId === longerId) longerWins++;
  }
  return { fights: longer, winPct: longer ? longerWins / longer : 0 };
});

export const longestStreaks = (w: World, n = 6) => memo(w, `longestStreaks:${n}`, () => {
  const out: { boxerId: number; len: number }[] = [];
  for (const b of w.boxers) {
    let cur = 0, best = 0;
    for (const x of w.boutsByBoxer.get(b.id) ?? []) {
      if (x.upcoming || !countsInRecord(x.method)) continue; // a no-contest is not in a fighter's record, so it cannot end a win streak either
      if (x.winnerId === b.id) { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    out.push({ boxerId: b.id, len: best });
  }
  return out.sort((a, b) => b.len - a.len).slice(0, n).map((x) => ({ boxer: w.byId.get(x.boxerId)!, len: x.len }));
});
