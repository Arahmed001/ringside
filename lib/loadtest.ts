/** Latency numbers from a list of request times (ms): the percentile arithmetic behind `npm run loadtest`, kept pure so it can be tested. */
export interface Summary { n: number; reqPerSec: number; p50: number; p95: number; p99: number; max: number }
export function summarise(latencies: number[], seconds: number): Summary {
  const s = [...latencies].sort((a, b) => a - b);
  const at = (q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
  return { n: s.length, reqPerSec: seconds > 0 ? s.length / seconds : 0, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s.length ? s[s.length - 1] : 0 };
}

/** Pages worth hitting: every kind of view, in both languages, with the cheap JSON endpoints the type-ahead uses. */
export const LOAD_PATHS = ["/", "/rankings", "/boxers/ramil-abad", "/events", "/analytics", "/map", "/all-time/greatest", "/ar", "/boxers?page=2", "/compare?a=ramil-abad&b=tomas-villalba",
  "/matchmaking", "/trainers", "/upset-watch", "/fight-of-the-year", "/on-this-day", "/money", "/titles", "/people", "/api/search?q=ram", "/api/fighters?q=ram"];

/**
 * What the first visitor to a page pays beyond what everyone after them does: the first request's time, the median of the requests after it,
 * and the difference. The first request after a restart includes work the server only does when someone asks (building a table, scoring a year);
 * the later ones do not, so the difference is the cost of being first.
 */
export interface ColdCost { first: number; warm: number; extra: number }
export function coldCost(first: number, after: number[]): ColdCost {
  const s = [...after].sort((a, b) => a - b);
  const warm = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : first;
  return { first, warm, extra: Math.max(0, first - warm) };
}

/** A first visitor who waits longer than this beyond the usual time has a reason to leave: the line the check flags. */
export const SLOW_FIRST_VISIT_MS = 300;
