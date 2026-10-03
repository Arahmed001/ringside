import type { World } from "./world";
import { msg } from "./i18n/t";
import type { BoxerFull } from "./types";
import { DIVISIONS } from "./divisions";
import { memo } from "./memo";

export interface DivisionWeights {
  division: string;
  limitLb: number | null;
  n: number;
  missRate: number;
  avgUnderLimit: number; // lb below the limit at the scale, made-weight fighters only
  avgGain: number; // official -> fight night, lb
  avgFightNight: number;
}

const bouts = (w: World) => w.boutById;

export const divisionWeights = (w: World) => memo(w, "divisionWeights", () => computeDivisionWeights(w));

/** One pass over every weigh-in (completed bouts only), accumulating per division; the old version re-filtered all of them once per division. */
function computeDivisionWeights(w: World): DivisionWeights[] {
  const acc = new Map(DIVISIONS.map((d) => [d.name, { n: 0, missed: 0, underSum: 0, underN: 0, gainSum: 0, gainN: 0, nightSum: 0, nightN: 0 }]));
  for (const list of w.weighInsByBout.values()) for (const wi of list) {
    const b = w.boutById.get(wi.boutId);
    const a = b && !b.upcoming ? acc.get(b.weightClass) : undefined;
    if (!a || wi.officialLb === null) continue;
    a.n++;
    if (wi.madeWeight === false) a.missed++;
    else if (wi.limitLb !== null) { a.underSum += wi.limitLb - wi.officialLb; a.underN++; }
    if (wi.fightNightLb !== null) { a.gainSum += wi.fightNightLb - wi.officialLb; a.gainN++; a.nightSum += wi.fightNightLb; a.nightN++; }
  }
  return DIVISIONS.map((d) => {
    const a = acc.get(d.name)!;
    return {
      division: d.name, limitLb: d.lb, n: a.n,
      missRate: d.lb !== null && a.n ? a.missed / a.n : 0,
      avgUnderLimit: d.lb !== null && a.underN ? a.underSum / a.underN : 0,
      avgGain: a.gainN ? a.gainSum / a.gainN : 0,
      avgFightNight: a.nightN ? a.nightSum / a.nightN : 0,
    };
  });
}

export interface EdgeBucket { label: string; n: number; winRate: number }

/** Win rate bucketed by how much heavier (on fight night) a fighter was than his opponent. Decisive bouts only. */
export const fightNightEdge = (w: World) => memo(w, "fightNightEdge", () => computeEdge(w));
function computeEdge(w: World): EdgeBucket[] {
  const edges = [-Infinity, -8, -4, -1.5, 1.5, 4, 8, Infinity];
  const labels = [msg("8+ lb lighter"), msg("4–8 lb lighter"), msg("1.5–4 lb lighter"), msg("within 1.5 lb"), msg("1.5–4 lb heavier"), msg("4–8 lb heavier"), msg("8+ lb heavier")];
  const tally = labels.map(() => ({ n: 0, wins: 0 }));
  for (const b of w.bouts) {
    if (b.upcoming || !b.winnerId) continue;
    const list = w.weighInsByBout.get(b.id);
    const r = list?.find((x) => x.boxerId === b.redId), u = list?.find((x) => x.boxerId === b.blueId);
    if (!r?.fightNightLb || !u?.fightNightLb) continue;
    for (const [mine, theirs, id] of [[r.fightNightLb, u.fightNightLb, b.redId], [u.fightNightLb, r.fightNightLb, b.blueId]] as const) {
      const d = mine - theirs;
      const i = edges.findIndex((e, k) => d >= e && d < edges[k + 1]);
      tally[i].n++; if (b.winnerId === id) tally[i].wins++;
    }
  }
  return labels.map((label, i) => ({ label, n: tally[i].n, winRate: tally[i].n ? tally[i].wins / tally[i].n : 0 }));
}

export interface WeightMiss { boxer: BoxerFull; boutId: number; date: string; over: number; limitLb: number; won: boolean | null; opponent: string }

export const missedWeights = (w: World, limit = 12) => memo(w, `missedWeights:${limit}`, () => computeMisses(w, limit));
function computeMisses(w: World, limit: number): { misses: WeightMiss[]; total: number; winRate: number } {
  const bm = bouts(w);
  const all: WeightMiss[] = [];
  let wins = 0, decided = 0;
  for (const list of w.weighInsByBout.values()) for (const wi of list) {
    if (wi.madeWeight !== false || wi.officialLb === null || wi.limitLb === null) continue;
    const b = bm.get(wi.boutId), boxer = w.byId.get(wi.boxerId);
    if (!b || b.upcoming || !boxer) continue;
    const won = b.winnerId === null ? null : b.winnerId === wi.boxerId;
    if (won !== null) { decided++; if (won) wins++; }
    all.push({ boxer, boutId: b.id, date: b.date, over: Math.round((wi.officialLb - wi.limitLb) * 10) / 10, limitLb: wi.limitLb, won, opponent: b.redId === wi.boxerId ? b.blueName : b.redName });
  }
  all.sort((a, b) => b.date.localeCompare(a.date));
  return { misses: all.slice(0, limit), total: all.length, winRate: decided ? wins / decided : 0 };
}

export interface WeightPoint { date: string; boutId: number; official: number | null; fightNight: number | null; limit: number | null; made: boolean | null }

export function weightHistory(w: World, boxerId: number): WeightPoint[] {
  const bm = bouts(w);
  return (w.weighInsByBoxer.get(boxerId) ?? []).flatMap((wi) => {
    const b = bm.get(wi.boutId);
    return b && !b.upcoming ? [{ date: b.date, boutId: b.id, official: wi.officialLb, fightNight: wi.fightNightLb, limit: wi.limitLb, made: wi.madeWeight }] : [];
  });
}

/** A fighter's typical rehydration (fight-night minus official), in lb; null if unknown. */
export function avgRehydration(w: World, boxerId: number): number | null {
  const g = (w.weighInsByBoxer.get(boxerId) ?? []).filter((x) => x.fightNightLb !== null && x.officialLb !== null).map((x) => x.fightNightLb! - x.officialLb!);
  return g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
}

export function missCount(w: World, boxerId: number): number {
  return (w.weighInsByBoxer.get(boxerId) ?? []).filter((x) => x.madeWeight === false).length;
}
