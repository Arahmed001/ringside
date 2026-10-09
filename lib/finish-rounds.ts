import type { BoutRow } from "./types";
import { isStoppage } from "./methods";

/**
 * When a fighter's stoppage wins come: the average round of the finish and how many ended in each round. Counted only from stoppage wins (a knockout,
 * a technical knockout or a corner retirement, as the record counts them) whose end round is held; a win without its round is left out and not guessed.
 * Fewer than `MIN_FINISHES` such wins give no figure: an average of two finishes is a coincidence, not a habit.
 */
type Row = Pick<BoutRow, "method" | "winnerId" | "status" | "upcoming" | "endRound">;
export const MIN_FINISHES = 3;

export interface FinishRounds {
  /** stoppage wins with a known end round */
  finishes: number;
  /** stoppage wins in all, including those whose round is not held */
  stoppageWins: number;
  /** mean end round, to one decimal place */
  average: number;
  /** the round with the most finishes (the earlier one on a tie) */
  commonRound: number;
  /** finishes[r - 1] = stoppage wins ending in round r, for r = 1 up to the latest round seen */
  byRound: number[];
}

export function finishRoundsOf(bouts: Row[], fighterId: number): FinishRounds | null {
  const counts = new Map<number, number>();
  let stoppageWins = 0, sum = 0, n = 0;
  for (const x of bouts) {
    if (x.upcoming || x.status === "cancelled" || x.winnerId !== fighterId || !isStoppage(x.method)) continue;
    stoppageWins++;
    if (!x.endRound || x.endRound < 1 || !Number.isInteger(x.endRound)) continue;
    n++; sum += x.endRound;
    counts.set(x.endRound, (counts.get(x.endRound) ?? 0) + 1);
  }
  if (n < MIN_FINISHES) return null;
  const last = Math.max(...counts.keys());
  const byRound = Array.from({ length: last }, (_, i) => counts.get(i + 1) ?? 0);
  const commonRound = byRound.indexOf(Math.max(...byRound)) + 1;
  return { finishes: n, stoppageWins, average: Math.round((sum / n) * 10) / 10, commonRound, byRound };
}
