/**
 * Edit distance for forgiving name search: Damerau-Levenshtein in its restricted form (an insertion, a deletion, a substitution, or two neighbouring
 * letters swapped, each costing one), cut off as soon as the answer must exceed `max` so a scan over thousands of names stays cheap.
 * Returns `max + 1` when the distance is more than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1; // only a shortcut: the scan below would say the same, more slowly
  const n = a.length, m = b.length;
  let prev2: number[] = [], prev = Array.from({ length: m + 1 }, (_, j) => j), cur: number[] = [];
  for (let i = 1; i <= n; i++) {
    cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return Math.min(prev[m], max + 1);
}

/**
 * How far `typed` is from the start of `word`, for someone still typing: the best edit distance to a prefix of the word about as long as what was typed
 * (one letter shorter to one longer, so a slip in the last letters does not hide the match). 0 when `word` starts with `typed`.
 */
export function prefixDistance(typed: string, word: string, max: number): number {
  if (word.startsWith(typed)) return 0;
  let best = max + 1;
  for (let len = Math.max(1, typed.length - 1); len <= Math.min(word.length, typed.length + 1); len++) best = Math.min(best, editDistance(typed, word.slice(0, len), max));
  return best;
}

/** How many slips to forgive in a word of this length: none in the shortest (too many words are one slip apart), one in a short name, two in a long one. */
export const allowedSlips = (len: number): number => (len <= 3 ? 0 : len <= 6 ? 1 : 2);
