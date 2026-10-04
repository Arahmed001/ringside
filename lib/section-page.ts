/** The query string of a page, as the page receives it (a repeated key is an array: the first is taken). */
export type Query = Record<string, string | string[] | undefined>;
export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * The address of page `n` of one long list on a page that has several (a gym's fighters, its events, a trainer's stable and a manager's clients): each list has
 * its own query key, and the others keep the page they are on, so reading page 3 of one does not send another back to page 1. Page 1 has no key at all.
 */
export function sectionHref(path: string, query: Query, key: string, n: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) { const x = first(v); if (k !== key && x) p.set(k, x); }
  if (n > 1) p.set(key, String(n));
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}
