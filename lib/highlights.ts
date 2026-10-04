import type { BoutRow } from "./types";
import { countsInRecord } from "./methods";

/**
 * The story of a career in three lines, from the fights held: the best win (the opponent with the highest rating going in), the biggest upset (the win over the
 * opponent rated furthest above the winner), and the longest winning run. Pure functions of the fight list and the pre-fight ratings the world already replays.
 */
type Row = Pick<BoutRow, "id" | "date" | "method" | "winnerId" | "status" | "upcoming" | "redId" | "blueId">;
type Pre = Map<number, { red: number; blue: number }>;

export interface Highlights {
  bestWin: { boutId: number; opponentId: number; opponentRating: number } | null;
  /** only when the winner was rated at least `UPSET_GAP` below the opponent going in */
  biggestUpset: { boutId: number; opponentId: number; gap: number } | null;
  /** consecutive wins, in date order; a draw or a loss ends the run; only reported from `STREAK_MIN` */
  longestStreak: { wins: number; endedBoutId: number | null } | null;
}

export const UPSET_GAP = 100;
export const STREAK_MIN = 3;

export function highlightsOf(chronological: Row[], fighterId: number, pre: Pre): Highlights {
  let bestWin: Highlights["bestWin"] = null, upset: Highlights["biggestUpset"] = null;
  let run = 0, best = 0, bestEnd: number | null = null;
  const done = chronological.filter((x) => !x.upcoming && x.status !== "cancelled" && countsInRecord(x.method));
  for (let i = 0; i < done.length; i++) {
    const x = done[i];
    const red = x.redId === fighterId, p = pre.get(x.id);
    const won = x.winnerId === fighterId;
    if (won) {
      run++;
      if (run > best) { best = run; bestEnd = done[i + 1]?.id ?? null; }
      if (p) {
        const own = red ? p.red : p.blue, opp = red ? p.blue : p.red, oppId = red ? x.blueId : x.redId;
        if (!bestWin || opp > bestWin.opponentRating) bestWin = { boutId: x.id, opponentId: oppId, opponentRating: Math.round(opp) };
        if (opp - own >= UPSET_GAP && (!upset || opp - own > upset.gap)) upset = { boutId: x.id, opponentId: oppId, gap: Math.round(opp - own) };
      }
    } else run = 0;
  }
  // `endedBoutId` is the fight right after the longest run's last win (it ended the run), or null when the run is still going
  return { bestWin, biggestUpset: upset, longestStreak: best >= STREAK_MIN ? { wins: best, endedBoutId: bestEnd } : null };
}
