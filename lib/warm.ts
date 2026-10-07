import { currentYear, nowMs } from "./clock";
import { getWorld, whenRebuilt } from "./world";
import { collectGarbage } from "./gc";
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
import { LOCALES } from "./i18n/config";
import { getTFor } from "./i18n/dicts";
import { getNames } from "./i18n/names";
import { exampleQuestions } from "./ask/examples";
import { planByRules } from "./ask/rules";
import { toolByName } from "./ask/tools";
import { searchFighters } from "./fighter-search";
import { applyFilters } from "./ai";
import { globalSearch } from "./search";
import { countryList, countryView } from "./countries";
import { similarTo } from "./style";
import { suggestOpponents } from "./matchmaking";

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
  // (steps are kept short, one list or one language each, because the server answers requests between steps: see warmAggregates)
  ...LISTS.map((l): [string, (w: World) => unknown] => [`all-time list ${l.id}`, (w) => { recordList(w, l.id, {}, 5); if (l.subject !== "bout") recordList(w, l.id, {}, 10); }]),
  ["lineages", (w) => belts(w)],
  ["division rankings", (w) => { for (const sex of ["male", "female"] as const) for (const d of DIVISIONS) rankedBoxers(w, d.name, sex); }],
  ["upset watch record", (w) => upsetRecord(w)],
  ["upset watch signals", (w) => signalLift(w)],
  ["track record", (w) => trackRecord(w)],
  ["trainer impact", (w) => trainerImpact(w)],
  ["trainer moves", (w) => { moves(w); switchStudy(w); }],
  ["trainer lifters", (w) => { underdogLifters(w); recentTrainerChanges(w, 9); }],
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
  // the live answer under the home page's question box, in each language: the plan is the rule-based one (no model call), and the name table is the one the page is given, because the fighter-name index is kept per table
  ...LOCALES.map((locale): [string, (w: World) => unknown] => [`home answer ${locale}`, async (w) => {
    const t = await getTFor(locale), names = await getNames(locale), ctx = { w, t, names };
    for (const c of planByRules(exampleQuestions(w, t)[0], w, names)) toolByName(c.tool)?.run(ctx, c.args);
  }]),
  // the fighter-search index (every name, nickname and alias, normalised), one per language: the first search typed on the site would otherwise build it (140 ms at 19,000 fighters)
  // and the normalised text the fighters list's search box matches each fighter against (160 to 210 ms per search at 35,000 fighters when it was worked out on every request)
  ...LOCALES.map((locale): [string, (w: World) => unknown] => [`fighter search ${locale}`, async (w) => { const names = await getNames(locale); searchFighters(w, "zz", { names, forgiving: false }); applyFilters(w.boxers, { text: "zz" }, w, names); }]),
  ["data coverage", () => coverage()],
  // the first ⌘K search typed on the site built the index of events, people and organisations (270 ms at 160,000 bouts), and the first country page the country tables (290 ms)
  ...LOCALES.map((locale): [string, (w: World) => unknown] => [`global search ${locale}`, async (w) => { globalSearch(w, "zz", await getTFor(locale), await getNames(locale)); }]),
  ["countries", (w) => { const c = countryList(w)[0]; if (c) countryView(w, c.slug); }],
  // what every fighter page shares: the style vectors of the whole league and the set of booked fighters (docs/capacity.md); each is built once per world, by whoever asks first
  ["fighter page shared", (w) => { const b = w.boxers.find((x) => x.bouts >= 5 && x.active) ?? w.boxers.find((x) => x.bouts >= 5); if (b) { similarTo(b, w, 4); suggestOpponents(w, b, 3); } }],
];

/** Runs every step, returning how long each took and what went wrong with any that threw. */
export async function warmAggregates(w: World, opts: { gentle?: boolean } = {}): Promise<{ step: string; ms: number; error?: string }[]> {
  const out: { step: string; ms: number; error?: string }[] = [];
  let done = 0;
  for (const [step, run] of WARM_STEPS) {
    // between steps the requests that are waiting are answered (a step is 0.1 to 1 s of the one thread). At start-up that is a turn of the event loop; when the site is
    // serving and this is a rebuild's warm-up, the thread is given back for as long as the step took (at most a second), so visitors get half of it, not a turn in a dozen.
    await new Promise<void>((r) => setImmediate(r));
    const t0 = performance.now();
    try { await run(w); out.push({ step, ms: Math.round(performance.now() - t0) }); }
    catch (e) { out.push({ step, ms: Math.round(performance.now() - t0), error: e instanceof Error ? e.message : String(e) }); }
    if (opts.gentle) await new Promise<void>((r) => setTimeout(r, Math.min(1000, Math.round(performance.now() - t0))));
    // while the old world is still being served and the new one grows beside it, the garbage the steps leave is what would take the process to its peak: collect it as we go
    if (opts.gentle && ++done % 8 === 0) await collectGarbage();
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
    await collectGarbage(); // what the build and the warm-up left behind (lib/gc.ts)
  } catch (e) {
    // never keep the server from starting: the first request will try again and show the real error
    log(`[ringside] warm-up failed (${e instanceof Error ? e.message : String(e)}); the first request will retry`);
  }
}

/**
 * The world is valid for one calendar day, so it goes stale at midnight UTC. Rebuild just after midnight, when traffic is lowest, and without making anyone wait:
 * the tick asks for the world (which starts the rebuild behind the old one: lib/world.ts, `getWorld`) and then waits for the new one to be built, warmed and
 * shown. Visitors in the meantime are answered from yesterday's world. Not scheduled when the clock is pinned (tests, reproducible runs), unless a clock is injected.
 */
export function scheduleDailyWarm(log: (m: string) => void = console.log, clock: { now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown } = {}): void {
  if (process.env.RINGSIDE_NOW && !clock.now) return;
  const now = clock.now ?? nowMs;
  const timer = clock.setTimer ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref(); /* a pending timer must never keep the process alive */ return t; });
  const tick = () => {
    void dailyRebuild(log).finally(() => timer(tick, msUntilNextDay(now())));
  };
  timer(tick, msUntilNextDay(now()));
}

/** What the midnight tick does: ask for the world (a stale one starts its rebuild in the background and is returned), wait for the new one, then say so. */
export async function dailyRebuild(log: (m: string) => void = console.log): Promise<void> {
  const t0 = performance.now();
  try {
    const before = await getWorld();
    await whenRebuilt();
    const now = await getWorld();
    if (now !== before) log(`[ringside] new day: world rebuilt and shown in ${Math.round(performance.now() - t0)} ms: ${now.boxers.length} fighters, ${now.bouts.length} bouts`);
    else await warmWorld(log); // no background rebuild ran (the world was built at once, or the rebuild failed): warm what is there (memoised, so a no-op when it is already warm)
  } catch (e) {
    log(`[ringside] midnight rebuild failed (${e instanceof Error ? e.message : String(e)}); the next request will retry`);
  }
}
