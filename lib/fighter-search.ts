import type { World } from "./world";
import { recordStr } from "./world";
import { divisionLabel } from "./divisions";
import { tEn, type Names, type T } from "./i18n/t";
import type { BoxerFull } from "./types";
import { buildWordIndex, nearTexts, wordsOf } from "./fuzzy";
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
export const isEmptyTable = (names: Names) => { for (const _ in names) return false; return true; };
const indexes = new WeakMap<World, WeakMap<Names, Index>>();
function indexOf(w: World, names: Names): Index {
  if (isEmptyTable(names)) names = NO_NAMES;
  let per = indexes.get(w);
  if (!per) { per = new WeakMap(); indexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) {
    const entries = w.boxers.map((b) => {
      const ar = names[b.name], arNick = b.nickname ? names[b.nickname] : undefined;
      return { b, name: normalize(ar ? `${b.name} ${ar}` : b.name), hay: normalize(`${b.name} ${ar ?? ""} ${b.nickname ?? ""} ${arNick ?? ""} ${b.aliases.join(" ")}`) };
    });
    const words = buildWordIndex(entries.map((e) => e.hay));
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
  return [...nearTexts(vocab, typed)].map(([i, cost]) => ({ b: entries[i].b, cost })).filter((x) => x.b.bouts >= minBouts)
    .sort((x, y) => x.cost - y.cost || y.b.bouts - x.b.bouts || x.b.name.localeCompare(y.b.name)).slice(0, limit).map((x) => x.b);
}

export const toHit = (b: BoxerFull, t: T = tEn): FighterHit => ({ slug: b.slug, name: t.name(b.name), division: divisionLabel(b.weightClass, b.sex, t), country: b.country, record: recordStr(b) });

/** A slug if it is one, otherwise the best name match (so a typed name still works without JavaScript). */
export function resolveFighter(w: World, slug: string | undefined, typed: string | undefined, minBouts = 0, names?: Names): BoxerFull | undefined {
  if (slug) return w.bySlug.get(slug);
  if (typed?.trim()) return searchFighters(w, typed, { limit: 1, minBouts, names })[0];
  return undefined;
}
