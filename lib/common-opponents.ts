import type { World } from "./world";
import type { BoutRow, BoxerFull } from "./types";
import { careerView } from "./career";
import { countsInRecord } from "./methods";

/**
 * Who both fighters have faced, and how each of them did: the fan's shortcut for comparing two fighters who have never met ("A stopped him, B went the distance").
 * Every fight against an opponent is listed, in date order, so a rematch is not reduced to its last chapter. A no-contest and a fight not yet fought are left out
 * (neither is a result), and so is a fight between the two of them. `partial` is true when either career is held in part (the supplier states a longer record
 * than the fights Ringside holds), because an opponent missing from the list may simply be a fight not loaded.
 */
export interface CommonOpponent { opponent: BoxerFull; a: BoutRow[]; b: BoutRow[] }
export interface CommonOpponents { rows: CommonOpponent[]; total: number; partial: boolean }

const resultsOf = (w: World, x: BoxerFull) => {
  const by = new Map<number, BoutRow[]>();
  for (const f of w.boutsByBoxer.get(x.id) ?? []) {
    if (f.upcoming || f.status === "cancelled" || !f.method || !countsInRecord(f.method)) continue;
    const other = f.redId === x.id ? f.blueId : f.redId;
    const list = by.get(other);
    if (list) list.push(f); else by.set(other, [f]);
  }
  return by;
};

export function commonOpponents(w: World, a: BoxerFull, b: BoxerFull, limit = 8): CommonOpponents {
  const oa = resultsOf(w, a), ob = resultsOf(w, b);
  const rows: CommonOpponent[] = [];
  for (const [id, fa] of oa) {
    const fb = ob.get(id), opponent = w.byId.get(id);
    if (!fb || !opponent || id === a.id || id === b.id) continue;
    rows.push({ opponent, a: fa.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id)), b: fb.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id)) });
  }
  rows.sort((x, y) => y.opponent.rating - x.opponent.rating || x.opponent.id - y.opponent.id);
  return { rows: rows.slice(0, limit), total: rows.length, partial: careerView(a).source !== "loaded" || careerView(b).source !== "loaded" };
}
