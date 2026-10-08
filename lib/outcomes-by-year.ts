import type { BoutRow } from "./types";
import { countsInRecord, isDecision, isStoppage } from "./methods";
import { resultFor } from "./glance";

/**
 * A fighter's fights year by year, split by how each ended for him: wins by stoppage, wins on the scorecards, other wins (a disqualification),
 * draws and losses. Every year from the first fight to the last has a row, so a quiet year shows as a gap. Counted from the fights held, for a career held
 * whole; a no-contest, a cancelled fight and an upcoming one are left out. The year is read from the fight's date (YYYY-MM-DD).
 */
type Row = Pick<BoutRow, "date" | "method" | "winnerId" | "status" | "upcoming">;

export interface YearOutcomes { year: number; ko: number; decision: number; otherWin: number; draw: number; loss: number; total: number }

export function outcomesByYear(bouts: Row[], fighterId: number): YearOutcomes[] {
  const by = new Map<number, YearOutcomes>();
  for (const x of bouts) {
    if (!countsInRecord(x.method)) continue;
    const r = resultFor(x, fighterId);
    if (!r || r === "NC") continue;
    const year = Number(x.date.slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const row = by.get(year) ?? { year, ko: 0, decision: 0, otherWin: 0, draw: 0, loss: 0, total: 0 };
    if (r === "W") { if (isStoppage(x.method)) row.ko++; else if (isDecision(x.method)) row.decision++; else row.otherWin++; }
    else if (r === "L") row.loss++; else row.draw++;
    row.total++;
    by.set(year, row);
  }
  if (!by.size) return [];
  const years = [...by.keys()];
  const first = Math.min(...years), last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, i) => by.get(first + i) ?? { year: first + i, ko: 0, decision: 0, otherWin: 0, draw: 0, loss: 0, total: 0 });
}
