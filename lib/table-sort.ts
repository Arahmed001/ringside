import type { Ranked } from "./people-list";

/** Sorting a table by a column (round 121): the choice is in the address (`?sort=ko&dir=desc`), so it is shareable, works without scripts, and covers the whole list, not just the page on screen. */
export type Dir = "asc" | "desc";
export interface Sort<K extends string = string> { key: K; dir: Dir }

/** The order a column starts in the first time it is chosen: text and places upwards, figures and dates downwards (best, most, latest first). */
export const firstDir = (textual: boolean): Dir => (textual ? "asc" : "desc");

/** The sort asked for in the address, or the default when it names a column the table does not have (or nothing). A bare `sort=ko` takes the column's first direction. */
export function parseSort<K extends string>(sp: { sort?: string | string[]; dir?: string | string[] }, columns: Record<K, { textual: boolean }>, fallback: Sort<K>): Sort<K> {
  const key = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort, d = Array.isArray(sp.dir) ? sp.dir[0] : sp.dir;
  if (!key || !Object.prototype.hasOwnProperty.call(columns, key)) return fallback;
  const col = columns[key as K];
  return { key: key as K, dir: d === "asc" || d === "desc" ? d : firstDir(col.textual) };
}

/** Clicking a column: the one already sorted flips; another starts in its first direction. */
export const nextSort = <K extends string>(current: Sort<K>, key: K, textual: boolean): Sort<K> => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(textual) });

/** The query string for a sort: nothing at all for the table's default (a clean address), else `sort` and `dir`. */
export const sortQuery = <K extends string>(s: Sort<K>, fallback: Sort<K>): Record<string, string> => (s.key === fallback.key && s.dir === fallback.dir ? {} : { sort: s.key, dir: s.dir });

/**
 * The rows in the order asked for. Each row keeps the place it holds in the whole ranking; a row with no value for the column goes last whichever way it is sorted;
 * ties keep ranking order (so the same address always gives the same list). Text is compared without regard to accents and capitals.
 */
export function sortRanked<T>(rows: Ranked<T>[], by: Sort, value: (row: T) => number | string | null | undefined): Ranked<T>[] {
  const norm = (v: number | string) => (typeof v === "string" ? v.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase() : v);
  const sign = by.dir === "asc" ? 1 : -1;
  if (by.key === "rank") return [...rows].sort((a, b) => (a.rank - b.rank) * sign); // the place itself
  return rows.map((r) => ({ r, v: value(r.row) })).sort((a, b) => {
    const an = a.v === null || a.v === undefined || (typeof a.v === "number" && Number.isNaN(a.v)), bn = b.v === null || b.v === undefined || (typeof b.v === "number" && Number.isNaN(b.v));
    if (an !== bn) return an ? 1 : -1;
    if (!an && !bn) { const x = norm(a.v as number | string), y = norm(b.v as number | string); if (x !== y) return (x < y ? -1 : 1) * sign; }
    return a.r.rank - b.r.rank;
  }).map((x) => x.r);
}
