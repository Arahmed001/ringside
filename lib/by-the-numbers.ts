import type { BoutRow, EventRow } from "./types";
import { countsInRecord, endsEarly, isStoppage } from "./methods";

/**
 * The counting facts a fan quotes about a fighter, worked out from the fights held: how many rounds he has boxed, how often he goes the distance, how
 * quickly his wins come, where he has fought, his busiest year and his longest spell out of the ring. Pure functions of the fight list.
 *
 * Nothing is estimated. A figure that needs a fact the data does not give (the round a fight ended in, the scheduled rounds of a fight that went the
 * distance) is `null` rather than a guess, and the page leaves it out. The page shows the panel only for a career held whole: counted from part of a career
 * these would be wrong in a way that reads as right.
 */
type Row = Pick<BoutRow, "id" | "date" | "method" | "winnerId" | "status" | "upcoming" | "rounds" | "endRound" | "eventId">;
type Ev = Pick<EventRow, "country" | "venue" | "city">;

export interface Numbers {
  fights: number;
  /** rounds boxed (a round started counts), or null when a fight lacks the round it ended in or its scheduled rounds */
  rounds: number | null;
  /** fights that went the scheduled distance (a decision or a draw after it), of the fights counted */
  distance: { n: number; of: number };
  /** wins by stoppage inside three rounds, or null when a stoppage win lacks its round */
  quick: number | null;
  /** countries fought in, most fights first */
  countries: { name: string; n: number }[];
  /** the venue fought at most, when that is more than once */
  venue: { name: string; city: string; n: number } | null;
  /** the year with the most fights, when that is more than one */
  busiestYear: { year: number; n: number } | null;
  /** the longest gap between two fights, when it is half a year or more */
  layoff: { days: number; from: string; to: string } | null;
}

const DAY = 86400000;
export const MIN_LAYOFF_DAYS = 180;

export function numbersOf(chronological: Row[], fighterId: number, eventOf: (id: number) => Ev | undefined): Numbers {
  const done = chronological.filter((x) => !x.upcoming && x.status !== "cancelled" && countsInRecord(x.method));
  let rounds: number | null = 0, quick: number | null = 0, distance = 0;
  const countries = new Map<string, number>(), venues = new Map<string, { name: string; city: string; n: number }>(), years = new Map<number, number>();
  for (const x of done) {
    const early = endsEarly(x.method);
    if (early) { if (x.endRound && x.endRound > 0) { if (rounds !== null) rounds += x.endRound; } else rounds = null; }
    else { distance++; if (x.rounds > 0) { if (rounds !== null) rounds += x.rounds; } else rounds = null; }
    if (isStoppage(x.method) && x.winnerId === fighterId) { if (x.endRound && x.endRound > 0) { if (quick !== null && x.endRound <= 3) quick++; } else quick = null; }
    const ev = eventOf(x.eventId);
    if (ev?.country) countries.set(ev.country, (countries.get(ev.country) ?? 0) + 1);
    if (ev?.venue) { const k = `${ev.venue}|${ev.city}`, v = venues.get(k) ?? { name: ev.venue, city: ev.city, n: 0 }; v.n++; venues.set(k, v); }
    const y = Number(x.date.slice(0, 4));
    if (Number.isFinite(y)) years.set(y, (years.get(y) ?? 0) + 1);
  }
  const top = <T,>(m: Map<unknown, T>, n: (v: T) => number, tie: (a: T, b: T) => number) => [...m.values()].sort((a, b) => n(b) - n(a) || tie(a, b))[0];
  const venue = top(venues, (v) => v.n, (a, b) => (a.name < b.name ? -1 : 1));
  const yr = [...years].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  let layoff: Numbers["layoff"] = null;
  for (let i = 1; i < done.length; i++) {
    const days = Math.floor((Date.parse(done[i].date) - Date.parse(done[i - 1].date)) / DAY);
    if (Number.isFinite(days) && days >= MIN_LAYOFF_DAYS && (!layoff || days > layoff.days)) layoff = { days, from: done[i - 1].date, to: done[i].date };
  }
  return {
    fights: done.length, rounds, distance: { n: distance, of: done.length }, quick,
    countries: [...countries].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1)),
    venue: venue && venue.n >= 2 ? venue : null, busiestYear: yr && yr[1] >= 2 ? { year: yr[0], n: yr[1] } : null, layoff,
  };
}
