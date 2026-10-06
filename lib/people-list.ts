import { normalize } from "./fighter-search";
import { buildWordIndex, nearTexts, wordsOf } from "./fuzzy";
import { paginate } from "./paging";
import type { Names } from "./i18n/t";

/** Cards per page on the organisations index. */
export const ORGS_PAGE = 36;

/** Rows per page on the corners and officials leaderboards (and the default for any ranked list): all of a list is reachable, 50 at a time. */
export const PEOPLE_PAGE = 50;

/** A row with its place in the full, unfiltered ranking, so a filtered or paged list still says where each person stands. */
export interface Ranked<T> { rank: number; row: T }
export const ranked = <T,>(rows: T[]): Ranked<T>[] => rows.map((row, i) => ({ rank: i + 1, row }));

/**
 * The rows whose name has every word typed in it (accents and capitals ignored; English, and Arabic when the table has it), in ranking order. When nobody's
 * name has them all, the rows with a name a slip or two away from each word (see lib/fuzzy.ts), fewest slips first, and `close` says so: the page tells
 * the reader these are the nearest spellings. An empty query is every row.
 */
export function filterByName<T>(rows: Ranked<T>[], nameOf: (row: T) => string, query: string | undefined, names: Names): { rows: Ranked<T>[]; close: boolean } {
  const typed = wordsOf(normalize(query ?? ""));
  if (!typed.length) return { rows, close: false };
  const hay = rows.map((r) => { const n = nameOf(r.row); return normalize(names[n] ? `${n} ${names[n]}` : n); });
  const exact = rows.filter((_, i) => typed.every((word) => hay[i].includes(word)));
  if (exact.length) return { rows: exact, close: false };
  const near = [...nearTexts(buildWordIndex(hay), typed)].sort((a, b) => a[1] - b[1] || rows[a[0]].rank - rows[b[0]].rank).map(([i]) => rows[i]);
  return { rows: near, close: near.length > 0 };
}

/** One leaderboard as the page shows it: filtered by the name typed, then cut to the page asked for (a bad page number lands on a real one). */
export function pageRows<T>(rows: T[], nameOf: (row: T) => string, opts: { q?: string; page?: string; names: Names; /** rows per page (default 50) */ size?: number }) {
  return pageRanked(ranked(rows), nameOf, opts);
}

/** The same for rows that already carry their places (a table sorted by a column: lib/table-sort.ts), so each row keeps the place it holds in the whole ranking. */
export function pageRanked<T>(all: Ranked<T>[], nameOf: (row: T) => string, opts: { q?: string; page?: string; names: Names; size?: number }) {
  const size = opts.size ?? PEOPLE_PAGE;
  const found = filterByName(all, nameOf, opts.q, opts.names);
  const { page, pages, first } = paginate(found.rows.length, opts.page, size);
  return { shown: found.rows.slice(first, first + size), total: found.rows.length, of: all.length, close: found.close, page, pages };
}
