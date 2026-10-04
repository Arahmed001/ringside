import type { BoutRow } from "./types";
import { countsInRecord } from "./methods";

/**
 * The facts a fan looks for first on a fighter's page, worked out from the fights held: how the last five went, how long ago the last one was, and what the
 * opponent was going into each fight. Pure functions of the fight list, so they can be tested without a database.
 */
export type Result = "W" | "L" | "D" | "NC";

type Row = Pick<BoutRow, "id" | "date" | "method" | "winnerId" | "status" | "upcoming">;

/** How a fight went for one fighter. Only a fight with a result has one: an upcoming or cancelled fight is `null`. */
export function resultFor(b: Pick<BoutRow, "method" | "winnerId" | "status" | "upcoming">, fighterId: number): Result | null {
  if (b.upcoming || b.status === "cancelled" || b.method === null) return null;
  if (b.method === "NC") return "NC";
  return b.winnerId === null ? "D" : b.winnerId === fighterId ? "W" : "L";
}

/** The last `n` results, newest first, from a fighter's fights in date order. A no-contest is left out (it is not in the record either). */
export function form(chronological: Row[], fighterId: number, n = 5): Result[] {
  const out: Result[] = [];
  for (let i = chronological.length - 1; i >= 0 && out.length < n; i--) {
    const r = resultFor(chronological[i], fighterId);
    if (r && countsInRecord(chronological[i].method)) out.push(r);
  }
  return out;
}

export interface Since { unit: "days" | "months" | "years"; n: number }

/**
 * How long ago a date was, in the unit a person would say: days under two months, months under two years, years after. `null` for a date in the future or
 * one that cannot be read, so a page never prints "-3 days ago".
 */
export function since(today: string, date: string): Since | null {
  const d = Date.parse(date), t = Date.parse(today);
  if (!Number.isFinite(d) || !Number.isFinite(t) || d > t) return null;
  const days = Math.floor((t - d) / 86400000);
  if (days < 60) return { unit: "days", n: days };
  const a = new Date(d), z = new Date(t); // whole calendar months, so exactly two years ago is "2 years", not "23 months"
  const months = (z.getUTCFullYear() - a.getUTCFullYear()) * 12 + z.getUTCMonth() - a.getUTCMonth() - (z.getUTCDate() < a.getUTCDate() ? 1 : 0);
  return months < 24 ? { unit: "months", n: months } : { unit: "years", n: Math.floor(months / 12) };
}

export interface GoingIn {
  /** the opponent's Elo-style rating before the fight (1500 for a fighter with no earlier fight held) */
  rating: number;
  /** "W-L-D" before the fight; `null` when it cannot be stated truthfully (the opponent's career is held only in part) */
  record: string | null;
  /** the opponent had no earlier fight and the record is known: a professional debut */
  debut: boolean;
}

/**
 * What an opponent was going into one fight. The rating is the pre-fight rating the world already replays. The record is counted from the opponent's own
 * earlier fights, so it is stated only when `careerComplete`: for a fighter whose early career is not held (a partial load) the count would be short and
 * wrong, and the page shows the rating alone.
 */
export function goingIn(opponentFights: Row[], boutId: number, opponentId: number, rating: number, careerComplete: boolean): GoingIn {
  if (!careerComplete) return { rating, record: null, debut: false };
  let w = 0, l = 0, d = 0;
  for (const x of opponentFights) {
    if (x.id === boutId) break;
    const r = resultFor(x, opponentId);
    if (!r || !countsInRecord(x.method)) continue;
    if (r === "W") w++; else if (r === "L") l++; else d++;
  }
  return { rating, record: w + l + d ? `${w}-${l}-${d}` : null, debut: w + l + d === 0 };
}
