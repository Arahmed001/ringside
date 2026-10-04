import type { Filters } from "./ai";
import { bound, put, cmpOf, type Cmp } from "./search-quantities";

/**
 * What a fighter's record says besides the plain counts, asked in plain English: how often they have been stopped ("never been knocked out", "stopped more than twice",
 * "5 KO losses"), draws ("with a draw", "no draws"), the form they are in ("on a winning streak of at least 5", "won their last 3", "lost their last fight",
 * "unbeaten in their last 5") and when they last fought ("fought in the last 6 months", "has not fought in over a year", "last fought in 2024", "fought this year").
 * Each sets a filter on that fact and takes its words out of the sentence, so nothing reads them again; before round 53 "lost by knockout at least 3 times" was "3 or more
 * fights", "a 4 fight winning streak" was "4 or more fights", and "unbeaten in their last 5" was "undefeated".
 */

const NUMBER_WORDS: Record<string, number> = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const N = "(?<n>\\d+|once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten)";
const CMP = [
  "(?<ge>at least|no (?:fewer|less) than|a minimum of|minimum of)",
  "(?<gt>more than|over|above|greater than|exceeding|in excess of)",
  "(?<le>at most|no more than|a maximum of|maximum of|up to)",
  "(?<lt>fewer than|less than|under|below)",
  "(?<eq>exactly|precisely)",
].join("|");
const SUFFIX = "(?:(?<sge>or more|or higher|and over|and up|plus)|(?<sle>or fewer|or less|or lower))";
const num = (g: Record<string, string | undefined>) => (/^\d+$/.test(g.n!) ? +g.n! : NUMBER_WORDS[g.n!]);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (today: string, n: number, unit: string, sign: 1 | -1): string => {
  const d = new Date(today + "T12:00:00Z");
  if (/^year/.test(unit)) d.setUTCFullYear(d.getUTCFullYear() + sign * n);
  else if (/^month/.test(unit)) d.setUTCMonth(d.getUTCMonth() + sign * n);
  else if (/^week/.test(unit)) d.setUTCDate(d.getUTCDate() + sign * 7 * n);
  else d.setUTCDate(d.getUTCDate() + sign * n);
  return iso(d);
};
const dayBefore = (date: string) => iso(new Date(new Date(date + "T12:00:00Z").getTime() - 86400000));

/** `today` is the league's own date (a relative span needs it); without it a relative span is left in the sentence. */
export function peelRecord(q: string, f: Filters, today?: string): string {
  const take = (re: RegExp, set: (g: Record<string, string | undefined>) => void | false) => {
    q = q.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (...args) => {
      const groups = (args[args.length - 1] ?? {}) as Record<string, string | undefined>;
      return set(groups) === false ? (args[0] as string) : " ";
    });
  };
  const re = (src: string) => new RegExp(src, "i");
  const stopped = (g: Record<string, string | undefined>, fallback: Cmp) => { const [lo, hi] = bound(cmpOf(g, fallback), num(g)); put(f, "stopped", lo, hi); };
  const streak = (key: "minWinStreak" | "minLossStreak", n: number) => { f[key] = Math.max(f[key] ?? 0, n); };

  // stopped: none, and how many times
  take(re("\\b(?:never|not ever) (?:been |gotten |got )?(?:stopped|knocked out|ko'?d|tko'?d|kayoed)\\b|\\b(?:haven['’]?t|hasn['’]?t|have not|has not) (?:ever )?been (?:stopped|knocked out|ko'?d)\\b|\\bnever lost (?:by|via|to) (?:a )?(?:ko|knockout|stoppage|tko)\\b|\\b(?:no|zero) (?:ko|knockout|stoppage|tko) (?:loss(?:es)?|defeats?)\\b|\\bhave never been (?:stopped|knocked out)\\b"), () => put(f, "stopped", undefined, 0));
  // went the distance every time: no stoppage either way
  take(re("\\b(?:went|gone|go|goes) the distance (?:every time|in every fight|in all (?:their|his|her) fights|each time)\\b|\\bnever (?:been )?(?:finished|stopped) early\\b|\\bnever (?:had|have) (?:a )?fights? (?:end|ended) early\\b"), () => { put(f, "stopped", undefined, 0); put(f, "kos", undefined, 0); });
  take(re(`\\b(?:(?:${CMP})\\s+)?${N}\\+?\\s*(?:${SUFFIX}\\s+)?(?:ko|knockout|stoppage|tko) (?:loss(?:es)?|defeats?)\\b`), (g) => stopped(g, "ge"));
  // "stopped N opponents" is wins by knockout (the active voice); "been knocked out N times" and "stopped N times" are losses (the passive)
  take(re(`\\b(?:have |has |who )?(?:stopped|knocked out)\\s+(?:(?:${CMP})\\s+)?(?<n>\\d+)\\+?\\s*(?:opponents|fighters|boxers|men|rivals)\\b`), (g) => { const [lo, hi] = bound(cmpOf(g, "ge"), +g.n!); put(f, "kos", lo, hi); });
  take(re(`\\b(?:(?:ever|also) )?(?:been |got |gets |was |were )?(?:stopped|knocked out|ko'?d|tko'?d|lost by (?:a )?(?:ko|knockout|stoppage|tko))\\s+(?:(?:${CMP})\\s+)?${N}\\+?\\s*(?:${SUFFIX}\\s*)?(?:times?)?\\b`), (g) => stopped(g, "ge"));

  // draws: none, at least one, how many ("N draws" is read with the other counts)
  take(re("\\bnever (?:been )?(?:drawn|fought (?:to )?a draw|had a draw|drew)\\b|\\b(?:no|zero) draws\\b|\\bwithout a draw\\b|\\bnever drawn\\b"), () => put(f, "draws", undefined, 0));
  take(re("\\b(?:with|have|has|had|having) (?:a|at least one|one) draws?(?: on (?:their|his|her) record)?\\b|\\b(?:who|that) (?:have|has|had) drawn(?! (?:the )?most| more)\\b|\\bdrawn at least once\\b"), () => put(f, "draws", 1, undefined));

  // form: an unbeaten run, a streak, and the last results ("lost their last fight by knockout" is left as it is: how the last fight ended is not a filter, and answering with everyone who lost would look right and be wrong)
  take(re(`\\b(?:(?:haven['’]?t|hasn['’]?t|have not|has not) (?:ever )?lost|(?:no|zero) losses)\\s+(?:in|over|across|during)\\s+(?:their |his |her |the )?(?:last |past |previous |most recent )${N}\\s*(?:fights?|bouts?)?\\b`), (g) => { const n = num(g); if (!(n >= 1)) return false; f.unbeatenIn = Math.max(f.unbeatenIn ?? 0, n); });
  take(re(`\\b(?:unbeaten|undefeated|without a loss)\\s+(?:in|over|across|during)\\s+(?:their |his |her |the )?(?:last |past |previous |most recent )?${N}\\s*(?:fights?|bouts?)?\\b`), (g) => { const n = num(g); if (!(n >= 1)) return false; f.unbeatenIn = Math.max(f.unbeatenIn ?? 0, n); });
  take(re(`\\b(?:on )?(?:a |an )?(?:(?:${CMP})\\s+)?${N}[- ](?:fight|bout)[- ](?<kind>winning|win|losing|loss)(?: streak| run)?\\b`), (g) => { const [lo] = bound(cmpOf(g, "ge"), num(g)); streak(/^los/.test(g.kind!) ? "minLossStreak" : "minWinStreak", lo ?? num(g)); });
  take(re(`(?<!\\b(?:longest|best|biggest|current|most) )\\b(?:on )?(?:a |an )?(?<kind>winning|losing)\\s+(?:streak|run)(?:\\s+of\\s+(?:(?:${CMP})\\s+)?${N}(?:\\s*(?:fights?|bouts?))?)?\\b`), (g) => {
    const n = g.n ? num(g) : 2; // "on a winning streak": a streak is two or more
    const [lo] = bound(cmpOf(g, "ge"), n);
    streak(/^los/.test(g.kind!) ? "minLossStreak" : "minWinStreak", lo ?? n);
  });
  take(re(`\\b(?<kind>won|lost)\\s+(?:their |his |her )?(?:last|past|previous|most recent)(?!(?:\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten))?(?:\\s+(?:fights?|bouts?))?\\s+(?:by|via|in|to|against|at|with)\\b)\\s+${N}?\\s*(?:fights?|bouts?)?\\b`), (g) => { const n = g.n ? num(g) : 1; streak(g.kind!.toLowerCase() === "lost" ? "minLossStreak" : "minWinStreak", n); });

  if (today) {
    const spans = "(?:days?|weeks?|months?|years?)";
    // when they last fought
    take(re(`\\b(?:haven['’]?t|hasn['’]?t|have not|has not|didn['’]?t|did not|not) (?:fought|boxed|been in (?:a )?(?:fight|bout)|had (?:a )?(?:fight|bout)) (?:in|for)\\s+(?:(?<gt>over|more than)|(?<ge>at least))\\s+(?:the (?:last|past)\\s+)?(?<n>\\d+|a|one|two|three|four|five|six)\\s+(?<unit>${spans})\\b`), (g) => {
      const n = /^\d+$/.test(g.n!) ? +g.n! : g.n === "a" ? 1 : NUMBER_WORDS[g.n!];
      const cutoff = shift(today, n, g.unit!, -1);
      f.lastFightBefore = g.gt ? dayBefore(cutoff) : cutoff;
    });
    take(re(`\\b(?:inactive|idle|out of the ring|without a fight)\\s+(?:for|in)\\s+(?:(?<gt>over|more than)|(?<ge>at least))?\\s*(?<n>\\d+|a|one|two|three|four|five|six)\\s+(?<unit>${spans})\\b`), (g) => {
      const n = /^\d+$/.test(g.n!) ? +g.n! : g.n === "a" ? 1 : NUMBER_WORDS[g.n!];
      const cutoff = shift(today, n, g.unit!, -1);
      f.lastFightBefore = g.gt ? dayBefore(cutoff) : cutoff;
    });
    take(re(`\\b(?:have |has )?(?:fought|boxed|been in (?:a )?(?:fight|bout)|had a (?:fight|bout))\\s+(?:in|within|during)\\s+the\\s+(?:last|past)\\s+(?:(?<n>\\d+|one|two|three|four|five|six|twelve)\\s+)?(?<unit>${spans})\\b`), (g) => {
      const n = !g.n ? 1 : /^\d+$/.test(g.n) ? +g.n : g.n === "twelve" ? 12 : NUMBER_WORDS[g.n];
      f.lastFightAfter = shift(today, n, g.unit!, -1);
    });
    take(re("\\b(?:have |has )?(?:fought|boxed) this year\\b"), () => { f.lastFightAfter = today.slice(0, 4) + "-01-01"; });
    take(re("\\b(?:have |has )?(?:fought|boxed) last year\\b"), () => { const y = +today.slice(0, 4) - 1; f.lastFightAfter = `${y}-01-01`; f.lastFightBefore = `${y}-12-31`; });
  }
  // by year, which needs no date to compare with
  q = q.replace(/\blast fought\s+(?:before|prior to|earlier than)\s+((?:19|20)\d\d)\b/gi, (_m, y: string) => { f.lastFightBefore = `${+y - 1}-12-31`; return " "; });
  q = q.replace(/\blast fought\s+since\s+((?:19|20)\d\d)\b/gi, (_m, y: string) => { f.lastFightAfter = `${y}-01-01`; return " "; });
  q = q.replace(/\blast fought\s+after\s+((?:19|20)\d\d)\b/gi, (_m, y: string) => { f.lastFightAfter = `${+y + 1}-01-01`; return " "; });
  q = q.replace(/\blast fought\s+(?:in|during)\s+((?:19|20)\d\d)\b/gi, (_m, y: string) => { f.lastFightAfter = `${y}-01-01`; f.lastFightBefore = `${y}-12-31`; return " "; });
  q = q.replace(/\b(?:haven['’]?t|hasn['’]?t|have not|has not|didn['’]?t|did not|not) fought since\s+((?:19|20)\d\d)\b/gi, (_m, y: string) => { f.lastFightBefore = `${y}-12-31`; return " "; });
  q = q.replace(/\b(?:have |has )?(?:fought|boxed) since\s+((?:19|20)\d\d)\b/gi, (_m, y: string) => { f.lastFightAfter = `${y}-01-01`; return " "; });
  return q;
}
