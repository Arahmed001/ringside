import { currentYear, nowMs } from "./clock";
import { getWorld } from "./world";
import type { World } from "./world";
import { signalLift, upsetRecord } from "./upsets";
import { moves, switchStudy, trainerImpact, underdogLifters } from "./trainer-impact";
import * as A from "./analytics";
import * as M from "./money";
import { LISTS, recordList } from "./records";
import { orgsRanking, recentTrainerChanges, trainerLeaderboard } from "./team";
import { record as trackRecord } from "./accountability";
import { divisionWeights, fightNightEdge, missedWeights } from "./weights";
import { belts } from "./lineage";
import { dayOf, onThisDay } from "./on-this-day";
import { coverage } from "./coverage";
import { rankedBoxers } from "./rankings";
import { DIVISIONS } from "./divisions";

const DAY = 86_400_000;
/** Milliseconds from `now` to just after the next UTC midnight (the app's day is the UTC date; see clock.ts). */
export const msUntilNextDay = (now: number, slackMs = 5_000): number => DAY - (now % DAY) + slackMs;

/**
 * What the pages compute once per world and then keep (lib/memo.ts), grouped by the page that needs it. Each line calls the same function with the same
 * arguments the page does, because the cache key includes the arguments: a warm-up that asks for `topEarners(w, 5)` does nothing for a page that asks for 8.
 * Measured at 160,000 bouts in round 31 (`npm run coldcheck`), these were what a first visitor waited for: 0.2 to 0.8 s each on a dozen pages.
 * Each step is its own try, so one that fails (or a league too thin for it) cannot keep the rest from running.
 */
export const WARM_STEPS: [string, (w: World) => unknown][] = [
  // the all-time lists include the greatest fights ever, which scores every year of fights (the fighter pages need those too)
  ["all-time lists", (w) => { for (const l of LISTS) { recordList(w, l.id, {}, 5); if (l.subject !== "bout") recordList(w, l.id, {}, 10); } }],
  ["lineages", (w) => belts(w)],
  ["division rankings", (w) => { for (const sex of ["male", "female"] as const) for (const d of DIVISIONS) rankedBoxers(w, d.name, sex); }],
  ["upset watch record", (w) => { upsetRecord(w); signalLift(w); }],
  ["track record", (w) => trackRecord(w)],
  ["trainer impact", (w) => { trainerImpact(w); moves(w); switchStudy(w); underdogLifters(w); recentTrainerChanges(w, 9); }],
  ["organisations and corners", (w) => { orgsRanking(w); trainerLeaderboard(w); }],
  ["analytics", (w) => { A.overview(w); A.byWeightClass(w); A.methodSplit(w); A.boutsPerYear(w); A.finishHeat(w); A.biggestUpsets(w, 6); A.biggestUpsets(w, 200); A.countryLeaders(w); A.stanceEdge(w); A.reachEdge(w); A.longestStreaks(w, 6); A.finishRoundHistogram(w); A.biggestUpsets(w, 1, `${currentYear() - 1}-01-01`); }],
  ["money", (w) => {
    M.moneyCoverage(w); const years = M.revenueByYear(w); M.topGates(w, 8); M.topPpv(w, 8); M.topPurses(w, 10); M.topEarners(w, 10); M.broadcasterTable(w);
    const have = [...new Set(years.map((y) => y.year))].sort((a, b) => b - a), thisYear = Number(w.today.slice(0, 4)); // as the money page does
    const focus = have.includes(thisYear) ? thisYear : have[0];
    if (focus) M.topEarners(w, 8, focus);
  }],
  ["weigh-ins", (w) => { divisionWeights(w); fightNightEdge(w); missedWeights(w, 12); }],
  ["on this day", (w) => { const k = dayOf(w.today); if (k) onThisDay(w, k); }],
  ["data coverage", () => coverage()],
];

/** Runs every step, returning how long each took and what went wrong with any that threw. */
export async function warmAggregates(w: World): Promise<{ step: string; ms: number; error?: string }[]> {
  const out: { step: string; ms: number; error?: string }[] = [];
  for (const [step, run] of WARM_STEPS) {
    const t0 = performance.now();
    try { await run(w); out.push({ step, ms: Math.round(performance.now() - t0) }); }
    catch (e) { out.push({ step, ms: Math.round(performance.now() - t0), error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}

/**
 * Builds the in-memory world (and seeds an empty database) so the first visitor doesn't pay for it: about 0.1 s at the
 * demo size, 4 s at 160,000 bouts, and then the aggregates the pages need (`WARM_STEPS`, about 3 s more at that size).
 * Callers that arrive while it is building share the same build (lib/world.ts).
 */
export async function warmWorld(log: (m: string) => void = console.log): Promise<void> {
  const t0 = performance.now();
  try {
    const w = await getWorld();
    log(`[ringside] world ready in ${Math.round(performance.now() - t0)} ms: ${w.boxers.length} fighters, ${w.bouts.length} bouts`);
    const t1 = performance.now();
    const steps = await warmAggregates(w);
    for (const s of steps) if (s.error) log(`[ringside] warm-up step "${s.step}" failed (${s.error}); its page will compute it on the first visit`);
    log(`[ringside] pages warmed in ${Math.round(performance.now() - t1)} ms`);
  } catch (e) {
    // never keep the server from starting: the first request will try again and show the real error
    log(`[ringside] warm-up failed (${e instanceof Error ? e.message : String(e)}); the first request will retry`);
  }
}

/**
 * The world is valid for one calendar day, so it goes stale at midnight UTC and the next visitor would pay for the rebuild.
 * Rebuild just after midnight instead, when traffic is lowest. Not scheduled when the clock is pinned (tests, reproducible runs).
 */
export function scheduleDailyWarm(log: (m: string) => void = console.log): void {
  if (process.env.RINGSIDE_NOW) return;
  const tick = () => {
    void warmWorld(log).finally(() => { const t = setTimeout(tick, msUntilNextDay(nowMs())); t.unref(); });
  };
  const t = setTimeout(tick, msUntilNextDay(nowMs()));
  t.unref(); // a pending timer must never keep the process alive
}
