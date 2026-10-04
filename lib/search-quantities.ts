import type { Filters } from "./ai";

/**
 * The numbers in a plain-English fighter search: "more than 10 losses", "between 20 and 30 wins", "fewer than 5 fights", "a reach of at least 190",
 * "taller than 185 cm", "over 6 feet", "aged 30 to 35", "36 or older", "exactly 4 losses". Each one becomes a minimum, a maximum or both on the measure
 * the sentence names; a number is never read as another measure's (round 51: "more than 10 losses" had been read as "undefeated"), and a word
 * that sets a limit ("fewer than", "at most", "or fewer") is never dropped, because answering the opposite of the question looks like an answer.
 * "Over 35" means 36 and up and "under 25" means 24 and down; "at least" and "at most" keep their number; a bare number ("20 wins") is a minimum, as it
 * always was (the chip under the search says so), except an age ("30 years old", "aged 30"), which is exactly that age.
 */

export type Measure = "wins" | "losses" | "kos" | "bouts" | "age" | "height" | "reach" | "stopped" | "draws";
export type Cmp = "ge" | "gt" | "le" | "lt" | "eq";

const KEYS: Record<Measure, [keyof Filters, keyof Filters]> = {
  wins: ["minWins", "maxWins"], losses: ["minLosses", "maxLosses"], kos: ["minKOs", "maxKOs"], bouts: ["minBouts", "maxBouts"],
  age: ["minAge", "maxAge"], height: ["minHeight", "maxHeight"], reach: ["minReach", "maxReach"], stopped: ["minStopped", "maxStopped"], draws: ["minDraws", "maxDraws"],
};

const CMP_WORDS = [
  "(?<ge>at least|no (?:fewer|less) than|a minimum of|minimum of|minimum)",
  "(?<gt>more than|over|above|greater than|exceeding|in excess of|older than|taller than|longer than|bigger than)",
  "(?<le>at most|no more than|a maximum of|maximum of|maximum|up to)",
  "(?<lt>fewer than|less than|under|below|younger than|shorter than)",
  "(?<eq>exactly|precisely)",
].join("|");
const CMP = `(?:${CMP_WORDS})`;
const SUFFIX = "(?:(?<sge>or more|or higher|or over|and over|and up|and above|plus|or older|or taller|or longer|or greater)|(?<sle>or fewer|or less|or lower|or under|and under|and below|or younger|or shorter))";
const NOUN: Record<Exclude<Measure, "height" | "reach" | "stopped">, string> = {
  wins: "(?:wins?|victor(?:y|ies))",
  losses: "(?:loss(?:es)?|defeats?)",
  kos: "(?:kos?|knockouts?)",
  bouts: "(?:(?:pro(?:fessional)? )?(?:fights?|bouts?)|times)",
  draws: "(?:draws?|drawn fights?)",
  age: "(?:years? old|years? of age|yo)",
};
/** "5 knockout artists" and "80% knockout rate" name a style and a rate, not a number of knockouts. */
const NOT_A_STYLE = "(?!\\s+(?:artists?|specialists?|punchers?|rates?|percentages?|ratios?|power))";
const ANY_NOUN = Object.values(NOUN).join("|");
const FEET = "(?<ft>\\d)(?:\\s*(?:feet|foot|ft)\\b\\s*(?<in1>\\d{1,2})?|'\\s*(?<in2>\\d{1,2})?)";
const CM = "(?:cm|centimet(?:er|re)s?)";

/** The bounds a comparison word and a number put on a measure; `n` may be fractional (feet), so each rounds the way the word says. */
export function bound(cmp: Cmp, n: number): [number | undefined, number | undefined] {
  switch (cmp) {
    case "ge": return [Math.ceil(n), undefined];
    case "gt": return [Math.floor(n) + 1, undefined];
    case "le": return [undefined, Math.floor(n)];
    case "lt": return [undefined, Math.ceil(n) - 1];
    case "eq": return [Math.ceil(n), Math.floor(n)];
  }
}

export function put(f: Filters, m: Measure, lo: number | undefined, hi: number | undefined) {
  const [a, b] = KEYS[m];
  const rec = f as Record<string, number | undefined>;
  if (lo !== undefined) rec[a as string] = Math.max(rec[a as string] ?? -Infinity, lo);
  if (hi !== undefined) rec[b as string] = Math.min(rec[b as string] ?? Infinity, hi);
}

export const cmpOf = (g: Record<string, string | undefined> | undefined, fallback: Cmp): Cmp =>
  g?.ge ? "ge" : g?.gt ? "gt" : g?.le ? "le" : g?.lt ? "lt" : g?.eq ? "eq" : g?.sge ? "ge" : g?.sle ? "le" : fallback;

/** Reads every quantity out of `q`, sets the filters, and returns the sentence with those words taken out so no later rule reads them again. */
export function peelQuantities(q: string, f: Filters): string {
  /** Runs `set` on each match and takes the matched words out; a `set` that returns false leaves its match in the sentence. */
  const take = (re: RegExp, set: (g: Record<string, string | undefined>) => void | false) => {
    q = q.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (...args) => {
      const groups = (args[args.length - 1] ?? {}) as Record<string, string | undefined>;
      return set(groups) === false ? (args[0] as string) : " ";
    });
  };
  const one = (m: Measure, n: number, g: Record<string, string | undefined>, fallback: Cmp) => { const [lo, hi] = bound(cmpOf(g, fallback), n); put(f, m, lo, hi); };

  // the record as a whole
  take(/\b(?:a )?winning record\b|\bmore wins than losses\b/i, () => { f.record = "winning"; });
  take(/\b(?:a )?losing record\b|\bmore losses than wins\b/i, () => { f.record = "losing"; });
  // none of something, in words
  take(/\b(?:no|zero) (?:losses|defeats)\b|\bnever (?:lost|been (?:beaten|defeated))\b|\b(?:haven['’]?t|have not|hasn['’]?t|has not) (?:ever )?lost\b|\bwithout a (?:loss|defeat)\b/i, () => { put(f, "losses", undefined, 0); f.undefeated = true; });
  take(/\bwinless\b|\b(?:no|zero) wins\b|\bnever won(?! by)\b|\bwithout a win\b/i, () => put(f, "wins", undefined, 0));
  take(/\b(?:no|zero) (?:kos?|knockouts)\b|\bnever won by (?:a )?(?:ko|knockout)\b|\bwithout a (?:ko|knockout)\b/i, () => put(f, "kos", undefined, 0));

  // "lost more than 5 times" counts losses and "won at least 20 times" counts wins (a bare "times" counts fights: "fought 30 times")
  take(new RegExp(`\\b(?:lost|been (?:beaten|defeated))\\s+(?:${CMP}\\s+)?(?<n>\\d+)\\s*(?:\\+|${SUFFIX})?\\s*times\\b`, "i"), (g) => one("losses", +g.n!, g, "ge"));
  take(new RegExp(`\\bwon\\s+(?:${CMP}\\s+)?(?<n>\\d+)\\s*(?:\\+|${SUFFIX})?\\s*times\\b`, "i"), (g) => one("wins", +g.n!, g, "ge"));

  // reach, with or without the word "reach" first
  take(new RegExp(String.raw`\breach\s*(?:of|is|at)?\s*(?:between\s+)?(?<a>\d{2,3})\s*(?:cm)?\s*(?:and|to|-|–)\s*(?<b>\d{2,3})(?!\d)`, "i"), (g) => put(f, "reach", Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
  take(new RegExp(`\\breach\\s*(?:of|is|at)?\\s*(?:${CMP}\\s+)?(?<n>\\d{2,3})(?!\\d)\\s*(?:${CM})?(?:\\s*${SUFFIX})?`, "i"), (g) => one("reach", +g.n!, g, "ge"));
  take(new RegExp(`(?:${CMP}\\s+)?(?<n>\\d{2,3})\\s*(?:${CM}\\s*)?reach\\b(?:\\s*${SUFFIX})?`, "i"), (g) => one("reach", +g.n!, g, "ge"));

  // height: feet (and inches) or centimetres, or "taller than 185"
  take(new RegExp(String.raw`\bbetween\s+(?<a>\d{3})\s*(?:and|to|-|–)\s*(?<b>\d{3})\s*${CM}`, "i"), (g) => put(f, "height", Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
  const heightFeet = (g: Record<string, string | undefined>) => +g.ft! * 30.48 + +(g.in1 ?? g.in2 ?? 0) * 2.54;
  take(new RegExp(`(?:\\bheight\\s*(?:of|is)?\\s*)?(?:${CMP}\\s+)?${FEET}(?:\\s*tall)?(?:\\s*${SUFFIX})?`, "i"), (g) => one("height", heightFeet(g), g, "ge"));
  take(new RegExp(`(?:\\bheight\\s*(?:of|is)?\\s*)?(?:${CMP}\\s+)?(?<n>\\d{3})\\s*${CM}(?:\\s*tall)?(?:\\s*${SUFFIX})?`, "i"), (g) => one("height", +g.n!, g, "ge"));
  take(new RegExp(String.raw`\b(?:(?<gt>taller)|(?<lt>shorter)) than (?<n>\d{3})(?!\d)`, "i"), (g) => one("height", +g.n!, g, "gt"));

  // a range of a counted thing: "between 15 and 25 wins", "20 to 30 wins", "from 5-10 KOs"
  for (const [m, noun] of Object.entries(NOUN) as [Exclude<Measure, "height" | "reach" | "stopped">, string][]) {
    take(new RegExp(`\\bbetween\\s+(?<a>\\d+)\\s*(?:and|to|-|–)\\s*(?<b>\\d+)\\s*${noun}\\b`, "i"), (g) => put(f, m, Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
    take(new RegExp(`(?<![\\d.])(?:from\\s+)?(?<a>\\d+)\\s*(?:to|-|–)\\s*(?<b>\\d+)\\s*${noun}\\b`, "i"), (g) => put(f, m, Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
  }
  // an age range with no unit: "aged 30 to 35", "between 25 and 30"
  take(new RegExp(String.raw`\bage[ds]?\s+(?:between\s+)?(?<a>\d{2})\s*(?:to|and|-|–)\s*(?<b>\d{2})\b`, "i"), (g) => put(f, "age", Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));

  // one number and what it counts: "more than 10 losses", "25+ wins", "10 or fewer fights", "fought more than 30 times", "at least 8 KOs"
  for (const [m, noun] of Object.entries(NOUN) as [Measure, string][]) {
    take(new RegExp(`(?<![\\d.])(?<!\\b(?:top|best|first|next|last)\\s)(?:${CMP}\\s+)?(?<n>\\d+)\\s*(?:\\+|${SUFFIX})?\\s*${noun}\\b${m === "kos" ? NOT_A_STYLE : ""}`, "i"), (g) => one(m, +g.n!, g, m === "age" ? "eq" : "ge"));
  }
  take(new RegExp(String.raw`\bage[ds]?\s+(?<n>\d{2})(?!\d)\s*(?:(?<sge>or older|and older|or over|and over|\+)|(?<sle>or younger|and younger|or under|and under))?`, "i"), (g) => one("age", +g.n!, g, "eq"));
  take(new RegExp(String.raw`(?<![\d.])(?<n>\d{2})\s*(?:(?<sge>or older|and older|or over|and over)|(?<sle>or younger|and younger))`, "i"), (g) => one("age", +g.n!, g, "eq"));
  // "over 35", "under 25", "older than 33": an age, when nothing counted follows
  take(new RegExp(`\\b${CMP}\\s+(?<n>\\d{2})(?![\\d.]|\\s*(?:%|(?:${ANY_NOUN}|${CM}|kg|lbs?|pounds|rounds?|percent)\\b))`, "i"), (g) => { const n = +g.n!; if (n < 16 || n > 60) return false; one("age", n, g, "eq"); });
  return q;
}
