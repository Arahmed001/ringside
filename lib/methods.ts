/**
 * How a bout ended, and what each ending means for records and statistics.
 *
 *  KO / TKO   stoppage by the referee or a knockout
 *  RTD        corner retirement between rounds (counted as a knockout in a fighter's record, as BoxRec does)
 *  DQ         disqualification (a win and a loss, but not a knockout)
 *  UD/MD/SD   unanimous / majority / split decision after the scheduled distance
 *  TD         technical decision: stopped early (usually an accidental cut) and decided on the scorecards
 *  DRAW       draw after the distance;  TDRAW  technical draw
 *  NC         no contest: the bout is excluded from both fighters' records
 */
export const METHODS = ["KO", "TKO", "RTD", "DQ", "UD", "MD", "SD", "TD", "TDRAW", "DRAW", "NC"] as const;
export type Method = (typeof METHODS)[number];

export const isStoppage = (m: string | null): boolean => m === "KO" || m === "TKO" || m === "RTD";
/** Stopped by the referee or knocked out (excludes corner retirements): what referee statistics measure. */
export const isRefereeStoppage = (m: string | null): boolean => m === "KO" || m === "TKO";
export const isDecision = (m: string | null): boolean => m === "UD" || m === "MD" || m === "SD" || m === "TD";
export const isDrawResult = (m: string | null): boolean => m === "DRAW" || m === "TDRAW";
/** Results that name a winner. */
export const hasWinner = (m: string | null): boolean => m !== null && m !== "NC" && !isDrawResult(m);
/** Results that appear in win-loss-draw records. */
export const countsInRecord = (m: string | null): boolean => m !== null && m !== "NC";
/** Results that carry judges' scorecards. */
export const hasScorecards = (m: string | null): boolean => isDecision(m) || isDrawResult(m);
/** Results that end before the scheduled distance, and so have a meaningful end round. */
export const endsEarly = (m: string | null): boolean => isStoppage(m) || m === "DQ" || m === "TD" || m === "TDRAW";

export const METHOD_NAME: Record<Method, string> = {
  KO: "Knockout", TKO: "Technical knockout", RTD: "Corner retirement", DQ: "Disqualification", UD: "Unanimous decision", MD: "Majority decision",
  SD: "Split decision", TD: "Technical decision", TDRAW: "Technical draw", DRAW: "Draw", NC: "No contest",
};

const ALIASES: [RegExp, Method][] = [
  [/^(ko|knock ?out|k\.o\.)$/, "KO"],
  [/^(tko|t\.k\.o\.|technical knock ?out|referee stoppage|stoppage|stopped|rsc)$/, "TKO"],
  [/^(rtd|retired|retirement|corner retirement|corner stoppage|corner)$/, "RTD"],
  [/^(dq|disqualif\w*|disqualified)$/, "DQ"],
  [/^(ud|unanimous( decision)?|decision unanimous|unanimous points|points|pts|decision)$/, "UD"],
  [/^(md|majority( decision)?|decision majority)$/, "MD"],
  [/^(sd|split( decision)?|decision split)$/, "SD"],
  [/^(td|technical decision|tech decision|technical points)$/, "TD"],
  [/^(tdraw|technical draw|td draw)$/, "TDRAW"],
  [/^(draw|drawn|d|majority draw|split draw|unanimous draw)$/, "DRAW"],
  [/^(nc|n c|no contest|no decision|nd|n d)$/, "NC"], // "N/C" and "N/D" arrive here with the slash flattened to a space
];

/** Maps vendor spellings ("Decision - Split", "Technical Knockout", "Corner Retirement") to a canonical method, or null if unknown. */
export function normalizeMethod(raw: string | null | undefined): Method | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.toLowerCase().replace(/[-_/–—:()]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if ((METHODS as readonly string[]).includes(raw)) return raw as Method;
  for (const [re, m] of ALIASES) if (re.test(s)) return m;
  // "decision unanimous" etc. after separators were flattened: look for the qualifier
  if (/decision|points/.test(s)) {
    if (/techn/.test(s)) return "TD";
    if (/unanim/.test(s)) return "UD";
    if (/major/.test(s)) return "MD";
    if (/split/.test(s)) return "SD";
  }
  return null;
}
