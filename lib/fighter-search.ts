import type { World } from "./world";
import { recordStr } from "./world";
import { divisionLabel } from "./divisions";
import { tEn, type Names, type T } from "./i18n/t";
import type { BoxerFull } from "./types";

export interface FighterHit { slug: string; name: string; division: string; country: string; record: string }

interface Entry { b: BoxerFull; name: string; hay: string }

/**
 * Lower-case, single-spaced, and folded so spellings meet: Latin accents drop ("José" = "jose") and the Arabic variants
 * people mix freely collapse (أ إ آ → ا, ى → ي, ة → ه, no vowel marks, no tatweel).
 */
export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ًͯ-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase().replace(/\s+/g, " ").trim();

const NO_NAMES: Names = {};
const indexes = new WeakMap<World, WeakMap<Names, Entry[]>>();
function indexOf(w: World, names: Names): Entry[] {
  let per = indexes.get(w);
  if (!per) { per = new WeakMap(); indexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) {
    idx = w.boxers.map((b) => {
      const ar = names[b.name], arNick = b.nickname ? names[b.nickname] : undefined;
      return { b, name: normalize(ar ? `${b.name} ${ar}` : b.name), hay: normalize(`${b.name} ${ar ?? ""} ${b.nickname ?? ""} ${arNick ?? ""} ${b.aliases.join(" ")}`) };
    });
    per.set(names, idx);
  }
  return idx;
}

/**
 * Type-ahead search over fighter names, nicknames and aliases, in English and (when `names` has them) Arabic. Every word you
 * type must appear somewhere; names that start with what you typed rank first, then names with a word that does, then everything
 * else, and within a rank the more experienced fighter wins. A linear scan over a pre-normalised index: about 1 ms at 20,000 fighters.
 */
export function searchFighters(w: World, query: string, opts: { limit?: number; minBouts?: number; names?: Names } = {}): BoxerFull[] {
  const q = normalize(query);
  if (!q) return [];
  const { limit = 8, minBouts = 0, names = NO_NAMES } = opts;
  const words = q.split(" ");
  const scored: { b: BoxerFull; rank: number }[] = [];
  for (const e of indexOf(w, names)) {
    if (e.b.bouts < minBouts) continue;
    if (!words.every((t) => e.hay.includes(t))) continue;
    const padded = ` ${e.name}`;
    const rank = e.name.startsWith(q) ? 0 : words.every((t) => padded.includes(` ${t}`)) ? 1 : 2;
    scored.push({ b: e.b, rank });
  }
  scored.sort((x, y) => x.rank - y.rank || y.b.bouts - x.b.bouts || x.b.name.localeCompare(y.b.name));
  return scored.slice(0, limit).map((s) => s.b);
}

export const toHit = (b: BoxerFull, t: T = tEn): FighterHit => ({ slug: b.slug, name: t.name(b.name), division: divisionLabel(b.weightClass, b.sex, t), country: b.country, record: recordStr(b) });

/** A slug if it is one, otherwise the best name match (so a typed name still works without JavaScript). */
export function resolveFighter(w: World, slug: string | undefined, typed: string | undefined, minBouts = 0, names?: Names): BoxerFull | undefined {
  if (slug) return w.bySlug.get(slug);
  if (typed?.trim()) return searchFighters(w, typed, { limit: 1, minBouts, names })[0];
  return undefined;
}
