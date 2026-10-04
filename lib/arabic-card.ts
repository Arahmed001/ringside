/**
 * Lays out an Arabic word for the share-card renderer (next/og, which draws with satori).
 *
 * That renderer measures an Arabic word from its unjoined letters, about half as wide again as the joined word it draws, so every word got a blank gap
 * beside it and titles wrapped to a second line while they still fitted. It also lays text out left to right and only reverses runs of plain letters.
 * So each word is converted here: letters are replaced by their joined shapes (Unicode "presentation forms", which the card font carries), which the
 * renderer measures correctly, and the whole word is returned in left-to-right drawing order. Digits and Latin text keep their own order, as a browser
 * would set them. Only the share cards use this; pages are shaped by the browser.
 */

/** [isolated, final, initial, medial] shape of each letter; an empty string means the letter has no such shape (the plain letter is used, or it does not join on that side). */
const SHAPES: Record<string, [string, string, string, string]> = {
  "\u0622": ["", "\ufe82", "", ""],
  "\u0623": ["", "\ufe84", "", ""],
  "\u0624": ["", "\ufe86", "", ""],
  "\u0625": ["", "\ufe88", "", ""],
  "\u0626": ["", "\ufe8a", "\ufe8b", "\ufe8c"],
  "\u0627": ["", "\ufe8e", "", ""],
  "\u0628": ["", "\ufe90", "\ufe91", "\ufe92"],
  "\u0629": ["", "\ufe94", "", ""],
  "\u062a": ["", "\ufe96", "\ufe97", "\ufe98"],
  "\u062b": ["", "\ufe9a", "\ufe9b", "\ufe9c"],
  "\u062c": ["", "\ufe9e", "\ufe9f", "\ufea0"],
  "\u062d": ["", "\ufea2", "\ufea3", "\ufea4"],
  "\u062e": ["", "\ufea6", "\ufea7", "\ufea8"],
  "\u062f": ["", "\ufeaa", "", ""],
  "\u0630": ["", "\ufeac", "", ""],
  "\u0631": ["", "\ufeae", "", ""],
  "\u0632": ["", "\ufeb0", "", ""],
  "\u0633": ["", "\ufeb2", "\ufeb3", "\ufeb4"],
  "\u0634": ["", "\ufeb6", "\ufeb7", "\ufeb8"],
  "\u0635": ["", "\ufeba", "\ufebb", "\ufebc"],
  "\u0636": ["", "\ufebe", "\ufebf", "\ufec0"],
  "\u0637": ["", "\ufec2", "\ufec3", "\ufec4"],
  "\u0638": ["", "\ufec6", "\ufec7", "\ufec8"],
  "\u0639": ["", "\ufeca", "\ufecb", "\ufecc"],
  "\u063a": ["", "\ufece", "\ufecf", "\ufed0"],
  "\u0641": ["", "\ufed2", "\ufed3", "\ufed4"],
  "\u0642": ["", "\ufed6", "\ufed7", "\ufed8"],
  "\u0643": ["", "\ufeda", "\ufedb", "\ufedc"],
  "\u0644": ["", "\ufede", "\ufedf", "\ufee0"],
  "\u0645": ["", "\ufee2", "\ufee3", "\ufee4"],
  "\u0646": ["", "\ufee6", "\ufee7", "\ufee8"],
  "\u0647": ["", "\ufeea", "\ufeeb", "\ufeec"],
  "\u0648": ["", "\ufeee", "", ""],
  "\u0649": ["", "\ufef0", "", ""],
  "\u064a": ["", "\ufef2", "\ufef3", "\ufef4"],
};

/** lam + alef: [isolated, final] ligature of each alef. */
const LAM_ALEF: Record<string, [string, string]> = {
  "\u0622": ["\ufef5", "\ufef6"],
  "\u0623": ["\ufef7", "\ufef8"],
  "\u0625": ["\ufef9", "\ufefa"],
  "\u0627": ["\ufefb", "\ufefc"],
};

const LAM = "\u0644";
const DIACRITICS = /[\u064b-\u065f\u0670]/g;
const ARABIC_LETTER = /[\u0621-\u064a\u0671-\u06d3\ufe70-\ufefc]/;
const PLAIN_LETTER = /[\u0621-\u064a\u0671-\u06d3]/;
const LTR_CHAR = /[0-9A-Za-z]/;

/** True when the letter can join the letter that follows it (it has an initial shape). */
const joinsNext = (c: string | undefined) => !!c && !!SHAPES[c]?.[2];
/** True when the letter can be joined from the letter before it (it has a final shape). */
const joinsPrev = (c: string | undefined) => !!c && !!SHAPES[c]?.[1];

/** The letters of one word in their joined shapes, in reading order. Anything that is not an Arabic letter is left as it is. */
function joined(word: string): string[] {
  const w = [...word.replace(DIACRITICS, "")];
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const prevJoins = joinsNext(w[i - 1]) && joinsPrev(c);
    if (c === LAM && LAM_ALEF[w[i + 1]]) {
      const [iso, fin] = LAM_ALEF[w[i + 1]];
      out.push((prevJoins ? fin : iso) || c);
      if (!(prevJoins ? fin : iso)) out.push(w[i + 1]);
      i++;
      continue;
    }
    const s = SHAPES[c];
    if (!s) { out.push(c); continue; }
    const nextJoins = joinsNext(c) && joinsPrev(w[i + 1]);
    out.push((prevJoins && nextJoins ? s[3] : prevJoins ? s[1] : nextJoins ? s[2] : "") || c);
  }
  return out;
}

/**
 * One word (no spaces) as the card renderer should be given it, or the word unchanged when it has no Arabic letter in it (digits, "KO/TKO", "%40").
 * The result reads right to left once drawn left to right, which is how the renderer draws it.
 */
export function arabicForCard(word: string): string {
  if (!ARABIC_LETTER.test(word)) return word;
  // runs of Arabic text and of digits or Latin letters; punctuation goes with the Arabic, as it does in a right-to-left line
  const runs: { ltr: boolean; chars: string[] }[] = [];
  for (const c of joined(word)) {
    const ltr = LTR_CHAR.test(c);
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr) last.chars.push(c); else runs.push({ ltr, chars: [c] });
  }
  const visual: string[] = [];
  for (const r of runs.reverse()) visual.push(...(r.ltr ? r.chars : r.chars.reverse()));
  // the renderer reverses a run of plain (unjoined-shape) letters by itself, so such a run is put in once more reversed
  const out: string[] = [];
  for (let i = 0; i < visual.length; ) {
    if (!PLAIN_LETTER.test(visual[i])) { out.push(visual[i++]); continue; }
    let j = i;
    while (j < visual.length && PLAIN_LETTER.test(visual[j])) j++;
    out.push(...visual.slice(i, j).reverse());
    i = j;
  }
  return out.join("");
}
