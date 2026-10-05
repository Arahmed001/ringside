import type { World } from "./world";
import type { BoxerFull, Sex } from "./types";
import { nowMs } from "./clock";
import { memo } from "./memo";
import { careerView } from "./career";

export interface RankRow {
  rank: number;
  boxer: BoxerFull;
  delta: number | null; // rank movement vs 90 days ago (positive = climbed); null = new entry
  ratingChange: number; // Elo change over 90 days
}

const monthsAgo = (m: number) => new Date(nowMs() - m * 30.4 * 86400000).toISOString().slice(0, 10);

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

/** One division's ranked fighters, computed once per world: best first, each one's place, and where each stood three months ago (to say who has moved). */
interface Pool { sorted: BoxerFull[]; rankById: Map<number, number>; oldRank: Map<number, number>; past: string }
const poolOf = (w: World, division: string, sex: Sex): Pool => memo(w, `divisionPool:${sex}:${division}`, () => {
  const cutoff = monthsAgo(24);
  const pool = w.boxers.filter((b) => b.sex === sex && b.weightClass === division && eligible(b, 5, cutoff));
  const sorted = [...pool].sort((a, b) => b.rating - a.rating);
  const past = monthsAgo(3);
  const before = pool
    .map((b) => ({ b, r: ratingAt(w, b.id, past) }))
    .filter((x): x is { b: BoxerFull; r: number } => x.r !== null)
    .sort((a, b) => b.r - a.r);
  return { sorted, rankById: new Map(sorted.map((b, i) => [b.id, i + 1])), oldRank: new Map(before.map((x, i) => [x.b.id, i + 1])), past };
});

const rowOf = (w: World, p: Pool, b: BoxerFull, rank: number): RankRow => {
  const old = p.oldRank.get(b.id);
  const oldR = ratingAt(w, b.id, p.past);
  return { rank, boxer: b, delta: old ? old - rank : null, ratingChange: oldR === null ? 0 : b.rating - oldR };
};

/** Current ranking for a division: active, 5+ bouts, winning record, fought within 24 months, ordered by Elo. `offset` skips that many from the top (the rank numbers go on from there). */
export function rankDivision(w: World, division: string, limit = 15, sex: Sex = "male", offset = 0): RankRow[] {
  const p = poolOf(w, division, sex);
  return p.sorted.slice(offset, offset + limit).map((b, i) => rowOf(w, p, b, offset + i + 1));
}

/** Everyone ranked in a division, best first (shared: read-only), for a page that filters and pages the whole list. */
export const rankedBoxers = (w: World, division: string, sex: Sex = "male"): BoxerFull[] => poolOf(w, division, sex).sorted;

/** The row for one fighter of the division, with the rank it holds: for the cards of one page of a long list. */
export function rankRow(w: World, division: string, sex: Sex, boxer: BoxerFull, rank: number): RankRow {
  return rowOf(w, poolOf(w, division, sex), boxer, rank);
}

export function pound4pound(w: World, limit = 10, sex: Sex = "male"): BoxerFull[] {
  const cutoff = monthsAgo(24);
  return w.boxers.filter((b) => b.sex === sex && eligible(b, 8, cutoff)).sort((a, b) => b.rating - a.rating).slice(0, limit);
}

/** Where a fighter stands in the division, or null if he is not ranked (inactive, too few fights, a losing record, or no fight in 24 months). Not capped: the 217th of 217 has a place. */
export function rankOf(w: World, b: BoxerFull): number | null {
  return poolOf(w, b.weightClass, b.sex).rankById.get(b.id) ?? null;
}

/**
 * How much of the league the rankings can see. The rankings count only fights Ringside holds, and a ranking needs five of them; a league loaded in stages holds
 * only each fighter's most recent fights, so for a while few fighters qualify. `partialShare` is the share of fighters whose supplier career total is larger than
 * the fights held: above a half, the pages say why a division can be empty instead of showing a blank card.
 */
export function rankingDepth(w: World): { partialShare: number } {
  return memo(w, "rankingDepth", () => {
    const withTotal = w.boxers.filter((b) => b.vendorRecord);
    return { partialShare: withTotal.length ? withTotal.filter((b) => careerView(b).source !== "loaded").length / withTotal.length : 0 };
  });
}
