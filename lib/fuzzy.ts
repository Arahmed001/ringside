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

/** The words of a normalised text: split at spaces, hyphens and punctuation ("T. Al-Qahtani" is t, al, qahtani). */
export const wordsOf = (s: string) => s.split(/[\s\-.,;:!?؟،()"“”'’]+/).filter(Boolean);

/** Every distinct word of a list of texts (each already normalised), with the positions of the texts that have it, and each two or three neighbouring words run together ("Al-Qahtani" is also "alqahtani", "van der Berg" also "vanderberg"). */
export function buildWordIndex(texts: string[]): Map<string, number[]> {
  const words = new Map<string, number[]>();
  const put = (word: string, i: number) => { const l = words.get(word); if (!l) words.set(word, [i]); else if (l[l.length - 1] !== i) l.push(i); };
  texts.forEach((text, i) => {
    const ws = wordsOf(text);
    for (const x of ws) put(x, i);
    for (let k = 0; k + 1 < ws.length; k++) { put(ws[k] + ws[k + 1], i); if (k + 2 < ws.length) put(ws[k] + ws[k + 1] + ws[k + 2], i); }
  });
  return words;
}

/**
 * The texts with a word close to each word typed, and how many slips that took in all (fewest first is best). A word is close if it starts with what was
 * typed, is a slip or two away (see allowedSlips: a letter missing, added or wrong, or two neighbours swapped), or is a slip away from the start of it
 * (someone still typing). One or two letters are an initial and must start a word; three or fewer are exact. Every word typed must find a word in the text.
 */
export function nearTexts(vocab: Map<string, number[]>, typed: string[]): Map<number, number> {
  let candidates: Map<number, number> | null = null;
  for (const t of typed) {
    const found = new Map<number, number>();
    for (const [word, owners] of vocab) {
      // As a whole word, forgiveness follows the longer of the two (two letters gone from a long name are two slips). As the start of a longer word, only what was
      // typed counts: two slips in four letters is half the word, whatever the name's length. A typed word of 3 or fewer is exact, or an initial.
      const whole = t.length <= 3 ? 0 : allowedSlips(Math.max(t.length, word.length)), start = t.length <= 3 ? 0 : allowedSlips(t.length);
      let cost = 9;
      if (t.length <= 2) cost = word.startsWith(t) ? 0 : 9;
      else if (word.startsWith(t)) cost = 0;
      else if (whole > 0) { const e = editDistance(t, word, whole), p = prefixDistance(t, word, start); cost = Math.min(e <= whole ? e : 9, p <= start ? p : 9); }
      if (cost > 8) continue;
      for (const i of owners) if ((found.get(i) ?? 9) > cost) found.set(i, cost);
    }
    if (candidates === null) candidates = found;
    else { const next = new Map<number, number>(); for (const [i, c] of candidates) { const f = found.get(i); if (f !== undefined) next.set(i, c + f); } candidates = next; }
    if (!candidates.size) return new Map();
  }
  return candidates ?? new Map();
}
