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

/**
 * Three ways to choose the N fighters (round 73). The first load of the real league showed why the plain one is not enough: the 5,000 most recently active
 * fighters had 4,151 fights between them and 40,114 outside, so 96% of their records came out short and the load was refused.
 *  - `recent`: the N most recently active (what `--fighters N` has always done).
 *  - `opponents`: those N and every opponent they have in the fight list. Each of the N then has every one of his fights loaded; the opponents at the edge are short
 *    (their page shows the vendor's career total, labelled). It costs more requests than N: the number is printed by `--plan`.
 *  - `groups`: whole groups of fighters, taken newest group first, as long as a group fits in what is left of the N. A group is the chain of opponents' opponents
 *    (through fights that count in a record), so nobody in it has a fight outside it: every record in it can be right. A group bigger than what is left is skipped
 *    and counted, so the largest group (in a connected league there is often one huge one) is never taken by accident.
 */
export type SelectionMode = "recent" | "opponents" | "groups";

export interface ChosenSet { chosen: string[]; groupsTaken: number; groupsSkipped: number; largestGroup: number }

const counts = (b: Fight) => b.status !== "cancelled" && !!(b.winnerExternalId || b.method === "DRAW");

export function chooseByMode(bouts: Fight[], ranked: string[], n: number, mode: SelectionMode): ChosenSet {
  const first = ranked.slice(0, n);
  if (mode === "recent") return { chosen: first, groupsTaken: 0, groupsSkipped: 0, largestGroup: 0 };
  if (mode === "opponents") {
    const core = new Set(first), take = new Set(first); // opponents of the first N only, not of their opponents
    for (const b of bouts) {
      if (core.has(b.redExternalId)) take.add(b.blueExternalId);
      if (core.has(b.blueExternalId)) take.add(b.redExternalId);
    }
    // the first N keep their order, the opponents follow in the order of the ranking
    const extra = ranked.filter((id) => take.has(id) && !first.includes(id));
    return { chosen: [...first, ...extra], groupsTaken: 0, groupsSkipped: 0, largestGroup: 0 };
  }
  const parent = new Map<string, string>();
  for (const id of ranked) parent.set(id, id);
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; } return r; };
  for (const b of bouts) if (counts(b) && parent.has(b.redExternalId) && parent.has(b.blueExternalId)) parent.set(find(b.redExternalId), find(b.blueExternalId));
  const members = new Map<string, string[]>(); // the group's members in ranking order
  for (const id of ranked) { const r = find(id); (members.get(r) ?? members.set(r, []).get(r)!).push(id); }
  const groups = [...members.values()]; // each group sits where its most recently active member does (the first of its members in the ranking)
  groups.sort((a, b) => ranked.indexOf(a[0]) - ranked.indexOf(b[0]));
  const chosen: string[] = [];
  let taken = 0, skipped = 0, largest = 0;
  for (const g of groups) {
    largest = Math.max(largest, g.length);
    if (chosen.length + g.length <= n) { chosen.push(...g); taken++; } else skipped++;
  }
  return { chosen, groupsTaken: taken, groupsSkipped: skipped, largestGroup: largest };
}

/** What each mode would choose for `n`, for the plan to print: the fighters it asks for, and for groups how many groups it took, skipped and the largest. */
export interface ModePreview { n: number; opponents: number; groups: number; groupsTaken: number; groupsSkipped: number; largestGroup: number }
export function previewModes(bouts: Fight[], ranked: string[], n: number): ModePreview {
  const g = chooseByMode(bouts, ranked, n, "groups");
  return { n, opponents: chooseByMode(bouts, ranked, n, "opponents").chosen.length, groups: g.chosen.length, groupsTaken: g.groupsTaken, groupsSkipped: g.groupsSkipped, largestGroup: g.largestGroup };
}
