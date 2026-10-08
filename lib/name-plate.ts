/**
 * What to set on a fighter's picture block when there is no licensed photo: the surname in large condensed capitals where it is big enough to read, the
 * initials where it is not. A made-up silhouette says nothing about the person; their name does. Pure, so it can be tested without a page.
 *
 * The block is `size` wide. The surname is the last word of the name; a name of one word is its own surname. The type is sized so the longest word
 * fits on one line (a condensed capital is about 0.42 em wide), never above a third of the block's width, and the plate falls back to initials when the
 * surname would come out under 11 px.
 */
export interface Plate { kind: "surname" | "initials"; text: string; fontSize: number }

const WORD_EM = 0.44;

export function plateOf(name: string, size: number): Plate {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const surname = (words[words.length - 1] ?? "").replace(/[,.]/g, "");
  const initials = [...(words[0] ?? "")][0] && words.length > 1 ? [...words[0]][0] + [...surname][0] : [...(surname || "?")].slice(0, 2).join("");
  const usable = size * 0.88;
  const fit = Math.min(size * 0.34, usable / Math.max(1, [...surname].length * WORD_EM));
  if (surname && fit >= 11) return { kind: "surname", text: surname.toUpperCase(), fontSize: Math.floor(fit) };
  return { kind: "initials", text: initials.toUpperCase(), fontSize: Math.floor(size * 0.4) };
}
