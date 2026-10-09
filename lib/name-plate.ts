/**
 * What to set on a fighter's picture block when there is no licensed photo: the surname in large condensed capitals where it is big enough to read, the
 * initials where it is not. A made-up silhouette says nothing about the person; their name does. Pure, so it can be tested without a page.
 *
 * The block is `size` wide. The surname is the last word of the name; a name of one word is its own surname. The type is sized so the longest word
 * fits on one line (the heavy condensed capitals are about 0.53 em a letter, so 0.56 em is allowed), never above a third of the block's width, and the plate falls back to initials when the
 * surname would come out under 11 px.
 */
export interface Plate { kind: "surname" | "initials"; text: string; fontSize: number }

const WORD_EM = 0.56; // measured in a browser (round 137): the heavy condensed capitals with tracking-wide are 0.53 em a letter on average (GRANNUM, 57 px, was 210 px wide in a 200 px block at 0.44), and wider with an M or a W

/** Latin capitals in the Arabic pages' font (Tajawal) are wider than in the English pages' (Barlow Condensed): 0.675 em a letter measured, 0.72 allowed. */
const WORD_EM_AR = 0.72;

export function plateOf(name: string, size: number, locale: string = "en"): Plate {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const surname = (words[words.length - 1] ?? "").replace(/[,.]/g, "");
  const initials = [...(words[0] ?? "")][0] && words.length > 1 ? [...words[0]][0] + [...surname][0] : [...(surname || "?")].slice(0, 2).join("");
  const usable = size * 0.88;
  const fit = Math.min(size * 0.34, usable / Math.max(1, [...surname].length * (locale === "ar" ? WORD_EM_AR : WORD_EM)));
  if (surname && fit >= 11) return { kind: "surname", text: surname.toUpperCase(), fontSize: Math.floor(fit) };
  return { kind: "initials", text: initials.toUpperCase(), fontSize: Math.floor(size * 0.4) };
}
