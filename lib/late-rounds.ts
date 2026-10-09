import type { BoutRow } from "./types";
import { countsInRecord, endsEarly, isDecision } from "./methods";
import { resultFor } from "./glance";

/**
 * Two counts that say what the old subjective words ("cardio", "ring IQ") were reaching for, without inventing a rating.
 *
 * Late rounds: the record in fights that reached the eighth round, meaning a stoppage in round 8 or later, or a fight scheduled for eight rounds or more
 * that went to the scorecards. A fight whose end round is not held is left out, not guessed. Needs `MIN_LATE` such fights.
 *
 * Clear decisions: of the wins on the scorecards (unanimous, majority or split), how many were unanimous. Technical decisions are not counted: they end early
 * on a cut and say little about the scoring. Needs `MIN_DECISIONS` such wins.
 */
type Row = Pick<BoutRow, "method" | "winnerId" | "status" | "upcoming" | "rounds" | "endRound">;
export const MIN_LATE = 3;
export const MIN_DECISIONS = 5;

export interface LateRounds { fights: number; wins: number; losses: number; draws: number }
export interface ClearDecisions { wins: number; unanimous: number }

export function lateRoundsOf(bouts: Row[], fighterId: number): LateRounds | null {
  let wins = 0, losses = 0, draws = 0;
  for (const x of bouts) {
    if (!countsInRecord(x.method)) continue;
    const r = resultFor(x, fighterId);
    if (!r || r === "NC") continue;
    const reached = endsEarly(x.method) ? (x.endRound ?? 0) >= 8 : x.rounds >= 8;
    if (!reached) continue;
    if (r === "W") wins++; else if (r === "L") losses++; else draws++;
  }
  const fights = wins + losses + draws;
  return fights >= MIN_LATE ? { fights, wins, losses, draws } : null;
}

export function clearDecisionsOf(bouts: Row[], fighterId: number): ClearDecisions | null {
  let wins = 0, unanimous = 0;
  for (const x of bouts) {
    if (x.upcoming || x.status === "cancelled" || x.winnerId !== fighterId || !isDecision(x.method) || x.method === "TD") continue;
    wins++;
    if (x.method === "UD") unanimous++;
  }
  return wins >= MIN_DECISIONS ? { wins, unanimous } : null;
}
