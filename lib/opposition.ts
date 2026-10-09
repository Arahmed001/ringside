import type { BoutRow } from "./types";
import { countsInRecord } from "./methods";

/**
 * How strong a fighter's opposition was: the average rating of the opponents on the night each fight was fought (the rating they carried into it,
 * not today's). Beating an opponent who was rated 1,700 going in says more than beating one rated 1,300, and a rating today would not know the
 * difference between a fighter who was good then and one who has only improved since. Pure function of the fights and the ratings going in.
 *
 * Only fights that count in the record are used; a fight whose ratings going in are not held is left out, and fewer than `MIN_FIGHTS` fights give
 * no figure at all (an average of two opponents is not a quality score).
 */
type Row = Pick<BoutRow, "id" | "redId" | "blueId" | "method" | "status" | "upcoming">;
export const MIN_FIGHTS = 5;

export interface Opposition {
  fights: number;
  /** mean rating of the opponents going into each fight */
  average: number;
  /** the strongest opponent faced, by rating going in */
  strongest: { boutId: number; opponentId: number; rating: number };
}

export function oppositionOf(bouts: Row[], fighterId: number, pre: (boutId: number) => { red: number; blue: number } | undefined): Opposition | null {
  let n = 0, sum = 0;
  let strongest: Opposition["strongest"] | null = null;
  for (const x of bouts) {
    if (x.upcoming || x.status === "cancelled" || !countsInRecord(x.method)) continue;
    const p = pre(x.id);
    if (!p) continue;
    const red = x.redId === fighterId;
    if (!red && x.blueId !== fighterId) continue;
    const rating = red ? p.blue : p.red;
    if (!Number.isFinite(rating)) continue;
    n++; sum += rating;
    if (!strongest || rating > strongest.rating) strongest = { boutId: x.id, opponentId: red ? x.blueId : x.redId, rating };
  }
  return n >= MIN_FIGHTS && strongest ? { fights: n, average: sum / n, strongest } : null;
}
