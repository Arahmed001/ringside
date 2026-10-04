import { careerView } from "./career";
import type { Stance } from "./types";

/**
 * The controls on the fighters list: country, stance, active or retired, and the order. Every one is a plain query parameter, so a filtered list is a link, and
 * a value the page does not know is ignored rather than turned into an empty page. Pure, so the rules can be tested without a database.
 */
export const SORTS = ["rating", "recent", "wins", "ko"] as const;
export type Sort = (typeof SORTS)[number];
export const STATUSES = ["active", "retired"] as const;
export type Status = (typeof STATUSES)[number];

/** The wins a fighter needs before a knockout *rate* (knockouts as a share of wins) means anything: 4 knockouts in 4 wins is not a harder puncher than 15 in 17. */
export const KO_RATE_MIN_WINS = 5;

interface F {
  id: number; country: string; stance: Stance | null; active: boolean; rating: number; lastFight: string | null; bouts: number; wins: number; losses: number; draws: number; kos: number; koRate: number;
  vendorRecord?: { wins: number; losses: number; draws: number } | null;
}

export interface ListControls { country?: string; stance?: string; status?: string; sort?: string }

export const asSort = (v: string | undefined): Sort => (SORTS as readonly string[]).includes(v ?? "") ? (v as Sort) : "rating";
export const asStatus = (v: string | undefined): Status | undefined => (STATUSES as readonly string[]).includes(v ?? "") ? (v as Status) : undefined;

/** The countries and stances that exist in a list, so a control never offers a choice that gives nothing. */
export function optionsOf(list: F[]): { countries: string[]; stances: Stance[] } {
  return { countries: [...new Set(list.map((b) => b.country).filter(Boolean))].sort(), stances: (["Orthodox", "Southpaw", "Switch"] as Stance[]).filter((s) => list.some((b) => b.stance === s)) };
}

/** Whether a fighter's knockout rate can be compared: enough wins, and the whole career held (a partial career's rate would be built from a few of its fights). */
export const koRateComparable = (b: F): boolean => b.wins >= KO_RATE_MIN_WINS && careerView(b).source === "loaded";

/**
 * Filter, then order. `rating` keeps the order the list arrived in when no order is asked for (a search keeps its own relevance order); the others are explicit.
 * Ties fall to the higher rating, then to the id, so a page of the list never changes under a reload.
 */
export function applyControls<T extends F>(list: T[], c: ListControls, keepOrder = false): T[] {
  const status = asStatus(c.status);
  let out = list.filter((b) => (!c.country || b.country === c.country) && (!c.stance || b.stance === c.stance) && (!status || b.active === (status === "active")));
  const sort = asSort(c.sort);
  if (sort === "rating" && keepOrder) return out;
  const tie = (a: T, b: T) => b.rating - a.rating || a.id - b.id;
  const by: Record<Sort, (a: T, b: T) => number> = {
    rating: tie,
    recent: (a, b) => (a.lastFight === b.lastFight ? tie(a, b) : a.lastFight === null ? 1 : b.lastFight === null ? -1 : a.lastFight < b.lastFight ? 1 : -1),
    wins: (a, b) => careerView(b).wins - careerView(a).wins || tie(a, b),
    ko: (a, b) => Number(koRateComparable(b)) - Number(koRateComparable(a)) || (koRateComparable(a) ? b.koRate - a.koRate || b.kos - a.kos : 0) || tie(a, b),
  };
  out = out.slice().sort(by[sort]);
  return out;
}
