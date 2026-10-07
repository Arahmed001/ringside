import type { World } from "./world";
import type { BoutRow, BoxerFull } from "./types";
import { hasWinner, isDecision, isDrawResult, isStoppage } from "./methods";
import { divisionLabel } from "./divisions";
import { currentYear } from "./clock";
import { memo } from "./memo";
import { msg, type T } from "./i18n/t";

/**
 * The fight score (0-100): how much a fight had in it, worked out from what is on record about it.
 * Seven parts, each 0-1, combined with fixed weights. A part that cannot be worked out for a fight (no scorecards on
 * a decision, no punch statistics) is left out and the others are scaled up to fill its weight, so a fight is never
 * marked down for missing data; `coverage` says how much of the weight was available.
 *
 *  knockdowns   how often either man went down, and both of them going down counts for more
 *  finish       a decision as close as the cards allow (a split or a draw is the closest), or a stoppage late in the scheduled distance
 *  action       punches landed per round by both men against every other fight with statistics, and how evenly they traded
 *  matchup      two evenly matched fighters, both highly rated going in
 *  upset        the fighter the ratings did not favour won
 *  stakes       a title on the line (a world title, and a vacant one, count for most)
 *  comeback     the winner was knocked down on the way
 *
 * The weights are a judgment about what makes a great fight, not something fitted to votes: there are no votes here.
 */
export const PARTS = ["knockdowns", "finish", "action", "matchup", "upset", "stakes", "comeback"] as const;
export type PartKey = (typeof PARTS)[number];
export const WEIGHTS: Record<PartKey, number> = { knockdowns: 0.17, finish: 0.20, action: 0.20, matchup: 0.16, upset: 0.09, stakes: 0.08, comeback: 0.10 };
/** Fights scheduled for fewer rounds than this are not considered: four-round prelims are not fight-of-the-year material. */
export const MIN_ROUNDS = 6;

export interface FightFacts {
  kdRed: number; kdBlue: number;
  cards: [number, number][]; // [red, blue] per judge
  splitCards: boolean;
  lateness: number | null; // 0 (first round) to 1 (last scheduled round), stoppages only
  landedPerRound: number | null; // both fighters combined
  actionPercentile: number | null; // against every fight that has statistics
  redShare: number | null; // red's share of the punches landed
  pRed: number; // pre-fight chance for red from the ratings alone
  avgRating: number;
  winnerChance: number | null; // the winner's pre-fight chance
  kdAgainstWinner: number;
}

export interface FightScore {
  bout: BoutRow;
  score: number;
  parts: Record<PartKey, number | null>;
  coverage: number;
  facts: FightFacts;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const elo = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

export const isEligible = (b: BoutRow): boolean =>
  !b.upcoming && b.status === "completed" && !!b.method && b.method !== "NC" && b.method !== "DQ" && b.rounds >= MIN_ROUNDS;

/** Combined punches landed per round for every bout that has statistics, sorted: the yardstick for the action part. */
const actionScale = (w: World): number[] => memo(w, "actionScale", () => {
  const out: number[] = [];
  for (const [id, p] of w.punchTotals()) {
    const b = w.boutById.get(id);
    const rounds = p.rounds || b?.endRound || b?.rounds || 0;
    if (rounds) out.push(p.landed.reduce((s, x) => s + x, 0) / rounds);
  }
  return out.sort((a, b) => a - b);
});

const percentileIn = (sorted: number[], x: number): number => {
  if (!sorted.length) return 0.5;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
};

export function scoreFight(w: World, b: BoutRow): FightScore | null {
  if (!isEligible(b)) return null;
  const pre = w.boutPre.get(b.id);
  const ra = pre?.red ?? 1500, rb = pre?.blue ?? 1500;
  const pRed = elo(ra, rb);
  const winner = hasWinner(b.method) ? b.winnerId : null;
  const winnerChance = winner ? (winner === b.redId ? pRed : 1 - pRed) : null;
  const cards = (w.scorecardsByBout.get(b.id) ?? []).map((c): [number, number] => [c.red, c.blue]);
  const votes = new Set(cards.map(([r, u]) => Math.sign(r - u)));
  const split = cards.length > 1 && votes.size > 1;
  const stopped = isStoppage(b.method);
  const lateness = stopped && b.endRound && b.rounds > 1 ? clamp((b.endRound - 1) / (b.rounds - 1)) : null;
  const pt = w.punchTotals().get(b.id);
  const ptRounds = pt ? pt.rounds || b.endRound || b.rounds : 0;
  const landed = pt && ptRounds ? pt.landed.reduce((s, x) => s + x, 0) : null;
  const perRound = landed !== null ? landed / ptRounds : null;
  const redIdx = pt ? pt.boxers.indexOf(b.redId) : -1, blueIdx = pt ? pt.boxers.indexOf(b.blueId) : -1;
  const redShare = pt && landed && redIdx >= 0 && blueIdx >= 0 ? pt.landed[redIdx] / landed : null;
  const kdAgainstWinner = winner ? (winner === b.redId ? b.kdRed : b.kdBlue) : 0;
  const facts: FightFacts = {
    kdRed: b.kdRed, kdBlue: b.kdBlue, cards, splitCards: split, lateness, landedPerRound: perRound,
    actionPercentile: perRound === null ? null : percentileIn(actionScale(w), perRound), redShare, pRed, avgRating: (ra + rb) / 2, winnerChance, kdAgainstWinner,
  };

  const kdTotal = b.kdRed + b.kdBlue;
  const knockdowns = clamp(kdTotal / 4) * 0.7 + (b.kdRed > 0 && b.kdBlue > 0 ? 0.3 : 0);

  let finish: number | null;
  if (isDrawResult(b.method)) finish = 1;
  else if (stopped) finish = 0.25 + 0.75 * (lateness ?? 0) ** 1.5;
  else if (isDecision(b.method) && cards.length) {
    const margin = cards.reduce((s, [r, u]) => s + Math.abs(r - u), 0) / cards.length;
    const closeness = 1 - clamp(margin / (b.rounds * 0.4));
    finish = split ? Math.max(0.85, closeness) : closeness;
  } else finish = null;

  const action = facts.actionPercentile === null ? null : 0.65 * facts.actionPercentile + 0.35 * (redShare === null ? 0.5 : 1 - Math.abs(2 * redShare - 1));

  const matchup = 0.5 * (1 - Math.abs(2 * pRed - 1)) + 0.5 * clamp((facts.avgRating - 1500) / 250);
  const upset = winnerChance === null ? 0 : winnerChance < 0.5 ? clamp((0.5 - winnerChance) / 0.35) : 0;
  const stakes = b.title ? clamp(0.6 + (/world/i.test(b.title) ? 0.25 : 0) + (b.titleVacant ? 0.15 : 0)) : 0;
  const comeback = clamp(kdAgainstWinner / 2);

  const parts: Record<PartKey, number | null> = { knockdowns, finish, action, matchup, upset, stakes, comeback };
  let sum = 0, avail = 0;
  for (const k of PARTS) { const v = parts[k]; if (v !== null) { sum += WEIGHTS[k] * v; avail += WEIGHTS[k]; } }
  return { bout: b, score: Math.round((100 * sum) / avail), parts, coverage: avail, facts };
}

/**
 * One calendar year's eligible fights, best first (ties go to the earlier fight), kept as two typed arrays (the bout ids and their scores) and not as a list
 * of `FightScore`s: scoring every fight of the league and keeping each result (its seven parts and its facts) held 60 MB at 160,000 fights, and a page needs the
 * top few of a year, or one fight's place in it. The top are scored again when asked for (a few milliseconds; `scoreFight` gives the same answer each time).
 * The memo key keeps its old name: the warm-up and the tests look for it.
 */
interface YearIndex { ids: Int32Array; scores: Uint8Array }
const yearIndex = (w: World, year: number): YearIndex => memo(w, `fightsOfYear:${year}`, () => {
  const out: FightScore[] = [];
  for (const b of w.bouts) {
    if (!b.date.startsWith(String(year))) continue;
    const s = scoreFight(w, b);
    if (s) out.push(s);
  }
  out.sort((a, b) => b.score - a.score || a.bout.date.localeCompare(b.bout.date) || a.bout.id - b.bout.id);
  return { ids: Int32Array.from(out, (s) => s.bout.id), scores: Uint8Array.from(out, (s) => s.score) };
});

const scoredBout = (w: World, id: number): FightScore => scoreFight(w, w.boutById.get(id)!)!;

/** The best `n` fights of a calendar year, best first (a few are scored again each time: use this, not `fightsOfYear`, for a page). */
export const topFightsOfYear = (w: World, year: number, n: number): FightScore[] => Array.from(yearIndex(w, year).ids.subarray(0, n), (id) => scoredBout(w, id));
/** How many fights of a calendar year are eligible. */
export const fightCountOfYear = (w: World, year: number): number => yearIndex(w, year).ids.length;
/** One fight's score, the same number `fightsOfYear` lists it with (null when it is not eligible). */
export const fightScoreOf = (w: World, b: BoutRow): number | null => scoreFight(w, b)?.score ?? null;

/** Every eligible fight of a calendar year, best first (ties go to the earlier fight). Scores them all again: pages use `topFightsOfYear`. */
export const fightsOfYear = (w: World, year: number): FightScore[] => topFightsOfYear(w, year, Infinity);

/** Years that have at least one eligible fight, newest first. */
export const fightYears = (w: World): number[] => memo(w, "fightYears", () => {
  const ys = new Set<number>();
  for (const b of w.bouts) if (isEligible(b)) ys.add(Number(b.date.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
});

/** The year to feature: the latest one that is over (the current year is still being fought), or the current one if it is all there is. */
export const featuredYear = (w: World): number | null => { const ys = fightYears(w); return ys.find((y) => y < currentYear()) ?? ys[0] ?? null; };

/** The fight of each year, newest first. The current year is "so far": it can still change. */
export const fightOfTheYear = (w: World): { year: number; top: FightScore }[] => memo(w, "fightOfTheYear", () =>
  fightYears(w).flatMap((year) => { const top = topFightsOfYear(w, year, 1)[0]; return top ? [{ year, top }] : []; }));

/** Where one fight stands among the fights of its year (1 = fight of the year). */
export function fightRank(w: World, boutId: number): { year: number; rank: number; of: number; score: number } | null {
  const b = w.boutById.get(boutId);
  if (!b || !isEligible(b)) return null;
  const year = Number(b.date.slice(0, 4));
  const { ids, scores } = yearIndex(w, year);
  const i = ids.indexOf(boutId);
  return i < 0 ? null : { year, rank: i + 1, of: ids.length, score: scores[i] };
}

/** The best fights in the whole data, with an optional division filter. */
export const bestFightsEver = (w: World, n: number, division?: string): FightScore[] => memo(w, `bestFightsEver:${n}:${division ?? ""}`, () => {
  // the same candidates in the same order as before (newest year first, each year best first) and the same stable sort, so ties fall as they always did
  const all: { id: number; score: number; date: string }[] = [];
  for (const y of fightYears(w)) {
    const { ids, scores } = yearIndex(w, y);
    for (let i = 0; i < ids.length; i++) {
      const b = w.boutById.get(ids[i])!;
      if (!division || b.weightClass === division) all.push({ id: ids[i], score: scores[i], date: b.date });
    }
  }
  return all.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, n).map((x) => scoredBout(w, x.id));
});

export const PART_LABEL: Record<PartKey, string> = {
  knockdowns: msg("Knockdowns"), finish: msg("Finish"), action: msg("Action"), matchup: msg("Matchup"), upset: msg("Upset"), stakes: msg("Stakes"), comeback: msg("Comeback"),
};
export const TIER_LABEL = { classic: msg("Classic"), great: msg("Great fight"), good: msg("Good fight"), solid: msg("Solid"), routine: msg("Routine") };

/** A word for a score. Few fights reach the top tiers: a median fight scores about 25. */
export const tier = (score: number): "classic" | "great" | "good" | "solid" | "routine" =>
  score >= 70 ? "classic" : score >= 55 ? "great" : score >= 40 ? "good" : score >= 25 ? "solid" : "routine";

export interface Reason { kind: PartKey; text: string; weight: number }

/**
 * Why a fight scored as it did, in plain sentences, strongest first. Only parts that actually helped are mentioned
 * (a part under 0.45 is not a reason), so a fight is never praised for something it lacked.
 */
export function fightReasons(w: World, s: FightScore, t: T, max = 4): Reason[] {
  const { bout: b, parts, facts: f } = s;
  const name = (id: number) => t.name(w.byId.get(id)?.name ?? "");
  const winnerId = hasWinner(b.method) ? b.winnerId : null;
  const out: Reason[] = [];
  const add = (kind: PartKey, text: string) => { const v = parts[kind]; if (v !== null && v >= 0.45) out.push({ kind, text, weight: WEIGHTS[kind] * v }); };

  const kd = f.kdRed + f.kdBlue;
  if (kd > 0) add("knockdowns", f.kdRed > 0 && f.kdBlue > 0
    ? t.n(kd, "Both fighters went down: {n} knockdown in all", "Both fighters went down: {n} knockdowns in all")
    : t.n(kd, "{n} knockdown", "{n} knockdowns"));
  if (isDrawResult(b.method)) add("finish", t("A draw after {n} rounds, with nothing to choose between them", { n: b.rounds }));
  else if (isStoppage(b.method) && b.endRound) add("finish", t("Stopped in round {r} of {n}", { r: b.endRound, n: b.rounds }));
  else if (f.cards.length) add("finish", f.splitCards
    ? t("A split decision: the judges scored it {cards}", { cards: f.cards.map(([r, u]) => `${r}–${u}`).join(", ") })
    : t("Won on the cards by {margin} points on average", { margin: (f.cards.reduce((x, [r, u]) => x + Math.abs(r - u), 0) / f.cards.length).toFixed(1) }));
  if (f.landedPerRound !== null && f.actionPercentile !== null) add("action", t("{n} punches landed per round between them, busier than {pct}% of fights", { n: Math.round(f.landedPerRound), pct: Math.round(f.actionPercentile * 100) }));
  if (Math.abs(2 * f.pRed - 1) <= 0.4 && f.avgRating >= 1550) add("matchup", t("Evenly matched on the ratings ({a}% to {b}%), both highly rated", { a: Math.round(f.pRed * 100), b: Math.round((1 - f.pRed) * 100) }));
  if (winnerId && f.winnerChance !== null) add("upset", t("{name} won with only a {pct}% chance beforehand", { name: name(winnerId), pct: Math.round(f.winnerChance * 100) }));
  if (b.title) add("stakes", b.titleVacant ? t("A vacant title was decided: {title}", { title: t.name(b.title) }) : t("A title fight: {title}", { title: t.name(b.title) }));
  if (winnerId && f.kdAgainstWinner > 0) add("comeback", t("{name} won after being knocked down", { name: name(winnerId) }));
  return out.sort((a, c) => c.weight - a.weight).slice(0, max);
}

/** "Ryota Morishita beat Lukas Hartmann by split decision" in one line. */
export function resultLine(w: World, b: BoutRow, t: T): string {
  const red = w.byId.get(b.redId) as BoxerFull | undefined, blue = w.byId.get(b.blueId) as BoxerFull | undefined;
  const dv = red ? divisionLabel(b.weightClass, red.sex, t) : t(b.weightClass);
  if (!red || !blue) return dv;
  if (!hasWinner(b.method) || !b.winnerId) return t("{a} and {b} drew · {division}", { a: t.name(red.name), b: t.name(blue.name), division: dv });
  const [win, lose] = b.winnerId === red.id ? [red, blue] : [blue, red];
  return t("{a} beat {b} · {division}", { a: t.name(win.name), b: t.name(lose.name), division: dv });
}
