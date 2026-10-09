import type { BoutRow } from "./types";
import { countsInRecord } from "./methods";
import { resultFor } from "./glance";

/**
 * The last five opponents' records added together, each as it stood on the night they fought: "142 wins and 8 losses" says at once how hard the last five
 * fights were. Counted from the fights held, so it is stated only when every one of the five opponents' careers is held whole (`careerComplete`); a fighter
 * whose early career is missing would make the sum short and wrong, so then there is no figure rather than a smaller one.
 */
type Row = Pick<BoutRow, "id" | "redId" | "blueId" | "method" | "winnerId" | "status" | "upcoming">;

export interface LastFive { fights: number; wins: number; losses: number; draws: number }

export function opponentsLastFive(
  chronological: Row[], fighterId: number,
  opponentFights: (opponentId: number) => Row[], careerComplete: (opponentId: number) => boolean, n = 5,
): LastFive | null {
  const mine = chronological.filter((x) => !x.upcoming && x.status !== "cancelled" && countsInRecord(x.method) && (x.redId === fighterId || x.blueId === fighterId));
  if (mine.length < n) return null;
  let wins = 0, losses = 0, draws = 0;
  for (const x of mine.slice(-n)) {
    const opp = x.redId === fighterId ? x.blueId : x.redId;
    if (!careerComplete(opp)) return null;
    for (const f of opponentFights(opp)) {
      if (f.id === x.id) break;
      const r = resultFor(f, opp);
      if (!r || !countsInRecord(f.method)) continue;
      if (r === "W") wins++; else if (r === "L") losses++; else draws++;
    }
  }
  return { fights: n, wins, losses, draws };
}
