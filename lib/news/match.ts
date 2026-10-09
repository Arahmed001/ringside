import type { World } from "../world";
import { normalize } from "../fighter-search";
import { wordsOf } from "../fuzzy";
import { memo } from "../memo";
import type { NewsItem } from "./store";

/**
 * Which fighters a headline is about: a fighter is named when their whole name (two words or more) appears in the title or excerpt, as whole words. Only a name that is
 * one fighter's in the whole league counts (two "Jose Hernandez" are nobody's), and the fighter must have fought at least three times, so a stranger who shares a famous
 * man's name is not credited with his headlines. Some headlines name the wrong man this way and fewer miss the right one: it errs towards saying nothing.
 */
export const MIN_FIGHTS = 3;

const nameIndex = (w: World): Map<string, number> => memo(w, "newsNameIndex", () => {
  const count = new Map<string, number>(), who = new Map<string, number>();
  for (const b of w.boxers) {
    const k = wordsOf(normalize(b.name)).join(" ");
    if (k.split(" ").length < 2) continue;
    count.set(k, (count.get(k) ?? 0) + 1);
    if (b.bouts >= MIN_FIGHTS) who.set(k, b.id);
  }
  const m = new Map<string, number>();
  for (const [k, id] of who) if (count.get(k) === 1) m.set(k, id);
  return m;
});

/** The fighters named in a piece of text (ids, in order of appearance). */
export function fightersIn(w: World, text: string): number[] {
  const idx = nameIndex(w), words = wordsOf(normalize(text)), seen: number[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(5, words.length - i); n >= 2; n--) {
      const id = idx.get(words.slice(i, i + n).join(" "));
      if (id !== undefined) { if (!seen.includes(id)) seen.push(id); i += n - 1; break; }
    }
  }
  return seen;
}

/** boxer id -> the headlines that name them, newest first (items arrive newest first). */
export function newsByFighter(w: World, items: NewsItem[]): Map<number, NewsItem[]> {
  const out = new Map<number, NewsItem[]>();
  for (const it of items) for (const id of fightersIn(w, `${it.title}. ${it.snippet}`)) (out.get(id) ?? out.set(id, []).get(id)!).push(it);
  return out;
}
