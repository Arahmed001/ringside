/**
 * Reach against height (the "ape index" in difference form): how many centimetres a fighter's reach is over, or under, his height, and how that sits
 * against the fighters of his own division. A positive figure means a reach longer than the height. Only a fighter whose height and reach are both
 * held gets a figure, and the division average needs at least `MIN_PEERS` fighters with both held: a mean of three is not a division.
 * Nothing is estimated; an unknown height or reach is simply not shown.
 */
export const MIN_PEERS = 10;

interface Body { heightCm: number | null; reachCm: number | null }
const known = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export interface ReachIndex {
  heightCm: number;
  reachCm: number;
  /** reach minus height, in whole centimetres */
  diff: number;
  /** the division's mean of the same figure, or null when too few peers hold both measures */
  divisionDiff: number | null;
  /** how many peers the mean is over */
  peers: number;
}

export function reachIndex(b: Body, peers: Body[]): ReachIndex | null {
  if (!known(b.heightCm) || !known(b.reachCm)) return null;
  const diffs = peers.filter((p) => known(p.heightCm) && known(p.reachCm)).map((p) => p.reachCm! - p.heightCm!);
  return {
    heightCm: b.heightCm, reachCm: b.reachCm, diff: Math.round(b.reachCm - b.heightCm),
    divisionDiff: diffs.length >= MIN_PEERS ? Math.round(diffs.reduce((s, x) => s + x, 0) / diffs.length) : null,
    peers: diffs.length,
  };
}
