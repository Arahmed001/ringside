import type { World } from "./world";
import type { BoxerFull, WeighIn } from "./types";
import { DIVISIONS } from "./divisions";

export interface DivisionWeights {
  division: string;
  limitLb: number | null;
  n: number;
  missRate: number;
  avgUnderLimit: number; // lb below the limit at the scale, made-weight fighters only
  avgGain: number; // official -> fight night, lb
  avgFightNight: number;
}

const bouts = (w: World) => new Map(w.bouts.map((b) => [b.id, b]));

/** All weigh-ins with their bout's division attached (completed bouts only). */
function rows(w: World) {
  const bm = bouts(w);
  const out: { wi: WeighIn; division: string; date: string }[] = [];
  for (const list of w.weighInsByBout.values()) for (const wi of list) {
    const b = bm.get(wi.boutId);
    if (b && !b.upcoming) out.push({ wi, division: b.weightClass, date: b.date });
  }
  return out;
}

export function divisionWeights(w: World): DivisionWeights[] {
  const all = rows(w);
  return DIVISIONS.map((d) => {
    const r = all.filter((x) => x.division === d.name && x.wi.officialLb !== null);
    const made = r.filter((x) => x.wi.madeWeight !== false);
    const gains = r.filter((x) => x.wi.fightNightLb !== null && x.wi.officialLb !== null).map((x) => x.wi.fightNightLb! - x.wi.officialLb!);
    const under = d.lb !== null ? made.filter((x) => x.wi.limitLb !== null).map((x) => x.wi.limitLb! - x.wi.officialLb!) : [];
    const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    return {
      division: d.name, limitLb: d.lb, n: r.length,
      missRate: d.lb !== null && r.length ? r.filter((x) => x.wi.madeWeight === false).length / r.length : 0,
      avgUnderLimit: mean(under), avgGain: mean(gains), avgFightNight: mean(r.filter((x) => x.wi.fightNightLb !== null).map((x) => x.wi.fightNightLb!)),
    };
  });
}

export interface EdgeBucket { label: string; n: number; winRate: number }

/** Win rate bucketed by how much heavier (on fight night) a fighter was than his opponent. Decisive bouts only. */
export function fightNightEdge(w: World): EdgeBucket[] {
  const edges = [-Infinity, -8, -4, -1.5, 1.5, 4, 8, Infinity];
  const labels = ["8+ lb lighter", "4–8 lb lighter", "1.5–4 lb lighter", "within 1.5 lb", "1.5–4 lb heavier", "4–8 lb heavier", "8+ lb heavier"];
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

export function missedWeights(w: World, limit = 12): { misses: WeightMiss[]; total: number; winRate: number } {
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
