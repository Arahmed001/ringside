import type { World } from "./world";
import type { BoxerFull } from "./types";

export interface RankRow {
  rank: number;
  boxer: BoxerFull;
  delta: number | null; // rank movement vs 90 days ago (positive = climbed); null = new entry
  ratingChange: number; // Elo change over 90 days
}

const monthsAgo = (m: number) => new Date(Date.now() - m * 30.4 * 86400000).toISOString().slice(0, 10);

export function ratingAt(w: World, id: number, date: string): number | null {
  const h = w.history.get(id);
  if (!h) return null;
  let r: number | null = null;
  for (const x of h) { if (x.date <= date) r = x.rating; else break; }
  return r;
}

/** Ranked fighters must be active, have enough fights, have fought recently, and hold a winning record. */
function eligible(b: BoxerFull, minBouts: number, asOf: string): boolean {
  return b.active && b.bouts >= minBouts && b.winRate >= 0.5 && (b.lastFight ?? "") >= asOf;
}

/** Current ranking for a division: active, 5+ bouts, winning record, fought within 24 months, ordered by Elo. */
export function rankDivision(w: World, division: string, limit = 15): RankRow[] {
  const cutoff = monthsAgo(24);
  const pool = w.boxers.filter((b) => b.weightClass === division && eligible(b, 5, cutoff));
  const now = [...pool].sort((a, b) => b.rating - a.rating);
  const past = monthsAgo(3);
  const before = pool
    .map((b) => ({ b, r: ratingAt(w, b.id, past) }))
    .filter((x): x is { b: BoxerFull; r: number } => x.r !== null)
    .sort((a, b) => b.r - a.r);
  const oldRank = new Map(before.map((x, i) => [x.b.id, i + 1]));
  return now.slice(0, limit).map((b, i) => {
    const old = oldRank.get(b.id);
    const oldR = ratingAt(w, b.id, past);
    return { rank: i + 1, boxer: b, delta: old ? old - (i + 1) : null, ratingChange: oldR === null ? 0 : b.rating - oldR };
  });
}

export function pound4pound(w: World, limit = 10): BoxerFull[] {
  const cutoff = monthsAgo(24);
  return w.boxers.filter((b) => eligible(b, 8, cutoff)).sort((a, b) => b.rating - a.rating).slice(0, limit);
}

export function rankOf(w: World, b: BoxerFull): number | null {
  const r = rankDivision(w, b.weightClass, 200).find((x) => x.boxer.id === b.id);
  return r ? r.rank : null;
}
