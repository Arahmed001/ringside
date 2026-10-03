import type { World } from "./world";
import { recordStr } from "./world";
import { divisionLabel } from "./divisions";
import { tEn, type Names, type T } from "./i18n/t";
import type { BoxerFull } from "./types";
import { allowedSlips, editDistance, prefixDistance } from "./fuzzy";
import { Lru } from "./lru";

export interface FighterHit { slug: string; name: string; division: string; country: string; record: string }

interface Entry { b: BoxerFull; name: string; hay: string }
interface Index { entries: Entry[]; /** every distinct word of every name (and each pair of neighbouring words run together), with the entries that have it: the forgiving search scans these, not the fighters */ words: Map<string, number[]>; /** recent answers: a type-ahead asks the same thing again and again, and the forgiving scan is the slow part */ recent: Lru<string, BoxerFull[]> }

/**
 * Lower-case, single-spaced, and folded so spellings meet: Latin accents drop ("José" = "jose") and the Arabic variants
 * people mix freely collapse (أ إ آ → ا, ى → ي, ة → ه, no vowel marks, no tatweel).
 */
export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ًͯ-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase().replace(/\s+/g, " ").trim();

const NO_NAMES: Names = {};
/** Callers that pass an empty table (a fresh `{}` each time) must not each get their own index: an empty table is one table. */
const isEmpty = (names: Names) => { for (const _ in names) return false; return true; };
const indexes = new WeakMap<World, WeakMap<Names, Index>>();
/** The words of a normalised name: split at spaces, hyphens and punctuation ("T. Al-Qahtani" is t, al, qahtani). */
const wordsOf = (s: string) => s.split(/[\s\-.,;:!?؟،()"“”'’]+/).filter(Boolean);
function indexOf(w: World, names: Names): Index {
  if (isEmpty(names)) names = NO_NAMES;
  let per = indexes.get(w);
  if (!per) { per = new WeakMap(); indexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) {
    const entries = w.boxers.map((b) => {
      const ar = names[b.name], arNick = b.nickname ? names[b.nickname] : undefined;
      return { b, name: normalize(ar ? `${b.name} ${ar}` : b.name), hay: normalize(`${b.name} ${ar ?? ""} ${b.nickname ?? ""} ${arNick ?? ""} ${b.aliases.join(" ")}`) };
    });
    const words = new Map<string, number[]>();
    const put = (word: string, i: number) => { const l = words.get(word); if (!l) words.set(word, [i]); else if (l[l.length - 1] !== i) l.push(i); };
    entries.forEach((e, i) => {
      const ws = wordsOf(e.hay);
      for (const x of ws) put(x, i);
      // "Al Qahtani", "Al-Qahtani" and "Alqahtani" are one name to the person typing it
      for (let k = 0; k + 1 < ws.length; k++) put(ws[k] + ws[k + 1], i);
    });
    idx = { entries, words, recent: new Lru(500) };
    per.set(names, idx);
  }
  return idx;
}

/**
 * Type-ahead search over fighter names, nicknames and aliases, in English and (when `names` has them) Arabic. Every word you
 * type must appear somewhere; names that start with what you typed rank first, then names with a word that does, then everything
 * else, and within a rank the more experienced fighter wins. A linear scan over a pre-normalised index: about 1 ms at 20,000 fighters. When nothing
 * matches, `forgiving` looks for near spellings (below), about 30 ms at 20,000 fighters, and the recent answers are kept.
 */
export function searchFighters(w: World, query: string, opts: { limit?: number; minBouts?: number; names?: Names; /** try near spellings when nothing matches exactly (default yes) */ forgiving?: boolean } = {}): BoxerFull[] {
  const q = normalize(query);
  if (!q) return [];
  const { limit = 8, minBouts = 0, names = NO_NAMES, forgiving: tryNear = true } = opts;
  const words = wordsOf(q);
  if (!words.length) return [];
  const { entries, words: vocab, recent } = indexOf(w, names);
  const key = `${q}|${limit}|${minBouts}|${tryNear}`;
  const seen = recent.get(key);
  if (seen) return seen;
  const found = run(entries, vocab, q, words, limit, minBouts, tryNear);
  recent.set(key, found);
  return found;
}

function run(entries: Entry[], vocab: Map<string, number[]>, q: string, words: string[], limit: number, minBouts: number, tryNear: boolean): BoxerFull[] {
  const scored: { b: BoxerFull; rank: number }[] = [];
  for (const e of entries) {
    if (e.b.bouts < minBouts) continue;
    if (!words.every((t) => e.hay.includes(t))) continue;
    const padded = ` ${e.name}`;
    const rank = e.name.startsWith(q) ? 0 : words.every((t) => padded.includes(` ${t}`)) ? 1 : 2;
    scored.push({ b: e.b, rank });
  }
  if (!scored.length) return tryNear ? forgiving(entries, vocab, words, minBouts, limit) : [];
  scored.sort((x, y) => x.rank - y.rank || y.b.bouts - x.b.bouts || x.b.name.localeCompare(y.b.name));
  return scored.slice(0, limit).map((s) => s.b);
}

/**
 * What is left when nothing matched exactly: names with a word close to each word typed. A word is close if it starts with what was typed, is a
 * slip or two away from it (a letter missing, added, wrong, or two swapped; see allowedSlips), or is a slip away from the start of it. One or two letters
 * are an initial and must start a word. Every word typed has to find a word in the name; the name with the fewest slips in all comes first, then the more experienced fighter.
 */
function forgiving(entries: Entry[], vocab: Map<string, number[]>, typed: string[], minBouts: number, limit: number): BoxerFull[] {
  let candidates: Map<number, number> | null = null; // entry -> slips so far
  for (const t of typed) {
    const found = new Map<number, number>();
    for (const [word, owners] of vocab) {
      // Two ways to be close. As a whole word, forgiveness follows the longer of the two (two letters gone from a long name are two slips). As the start of a
      // longer word, only what was typed counts: two slips in four letters is half the word, whatever the name's length. A typed word of 3 or fewer is exact or an initial.
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
    if (!candidates.size) return [];
  }
  return [...(candidates ?? [])].map(([i, cost]) => ({ b: entries[i].b, cost })).filter((x) => x.b.bouts >= minBouts)
    .sort((x, y) => x.cost - y.cost || y.b.bouts - x.b.bouts || x.b.name.localeCompare(y.b.name)).slice(0, limit).map((x) => x.b);
}

export const toHit = (b: BoxerFull, t: T = tEn): FighterHit => ({ slug: b.slug, name: t.name(b.name), division: divisionLabel(b.weightClass, b.sex, t), country: b.country, record: recordStr(b) });

/** A slug if it is one, otherwise the best name match (so a typed name still works without JavaScript). */
export function resolveFighter(w: World, slug: string | undefined, typed: string | undefined, minBouts = 0, names?: Names): BoxerFull | undefined {
  if (slug) return w.bySlug.get(slug);
  if (typed?.trim()) return searchFighters(w, typed, { limit: 1, minBouts, names })[0];
  return undefined;
}
