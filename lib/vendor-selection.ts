import type { ProviderBout } from "./providers";

/**
 * Taking the real league in stages. 35,000 fighters cost three days at the plan's hourly limit, so a first load can be the most recently active fighters:
 * they are ranked by the date of their latest fight (coming fights count), the first N are fetched, and only the fights between two fetched fighters are
 * loaded. Everything here works from the fight list alone, which costs nothing extra, so what N would give can be read before it is spent.
 */
type Fight = Pick<ProviderBout, "redExternalId" | "blueExternalId" | "eventExternalId" | "status"> & Partial<Pick<ProviderBout, "winnerExternalId" | "method">>;

/** Fighter ids, the one with the most recent (or coming) fight first. A tie keeps the order the list gave them in. */
export function rankByRecency(bouts: Fight[], dateOf: Map<string, string>): string[] {
  const latest = new Map<string, string>(); // insertion order = first seen, which is the list's own order
  for (const b of bouts) {
    const d = dateOf.get(b.eventExternalId) ?? "";
    for (const id of [b.redExternalId, b.blueExternalId]) if ((latest.get(id) ?? "") < d || !latest.has(id)) latest.set(id, d);
  }
  return [...latest.entries()].map(([id, d], i) => ({ id, d, i })).sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : x.i - y.i)).map((x) => x.id);
}

export interface SelectionPreview {
  fighters: number;
  /** fights between two chosen fighters: what would be loaded */
  fights: number;
  /** chosen fighters every one of whose fights in the list is loaded (the opponents are chosen too) */
  whole: number;
  /** whole / fighters */
  share: number;
  /**
   * chosen fighters whose whole connected group (through fights that count in a record: a winner, or a draw) is chosen: the only ones whose records can ALL be
   * right, and what `--complete-only` could keep at most. A group is linked through its opponents' opponents, so this is far smaller than `whole` until most
   * of the league is chosen.
   */
  closed: number;
}

/**
 * What choosing the first `n` of `ranked` would load. `whole` is judged on the fight list only: a fighter whose fights in the list are all loaded may still be
 * short of the vendor's career total (the list can hold fewer fights than the career), which only the fighter fetch shows; it is the most the choice can give.
 */
export function previewSelection(bouts: Fight[], ranked: string[], n: number): SelectionPreview {
  const chosen = new Set(ranked.slice(0, n));
  const outside = new Set<string>(); // chosen fighters with a fight against someone not chosen
  let fights = 0;
  for (const b of bouts) {
    const a = chosen.has(b.redExternalId), c = chosen.has(b.blueExternalId);
    if (a && c) { fights++; continue; }
    if (a) outside.add(b.redExternalId);
    if (c) outside.add(b.blueExternalId);
  }
  const fighters = chosen.size, whole = fighters - outside.size;
  // groups of fighters linked by fights that count (union-find); a group is closed when every member is chosen
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
  for (const id of ranked) parent.set(id, id);
  for (const b of bouts) {
    if (b.status === "cancelled" || !(b.winnerExternalId || b.method === "DRAW")) continue;
    if (parent.has(b.redExternalId) && parent.has(b.blueExternalId)) parent.set(find(b.redExternalId), find(b.blueExternalId));
  }
  const open = new Set<string>(), size = new Map<string, number>();
  for (const id of ranked) { const r = find(id); size.set(r, (size.get(r) ?? 0) + (chosen.has(id) ? 1 : 0)); if (!chosen.has(id)) open.add(r); }
  const closed = [...size.entries()].reduce((n, [r, c]) => (open.has(r) ? n : n + c), 0);
  return { fighters, fights, whole, share: fighters ? whole / fighters : 0, closed };
}

/** The sizes worth showing for a list of `total` fighters: a few round numbers under it, and all of it. */
export function selectionSizes(total: number): number[] {
  const out = [1000, 2500, 5000, 10000, 20000].filter((n) => n < total);
  return [...out, total];
}
