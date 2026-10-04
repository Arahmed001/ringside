import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("search-record");
after(cleanup);
let ai: typeof import("../lib/ai");
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let countries: string[];
const T = "2026-10-03";

before(async () => {
  ai = await import("../lib/ai");
  rules = await import("../lib/ask/rules");
  w = await (await import("../lib/world")).getWorld();
  countries = [...new Set(w.boxers.map((b) => b.country))];
});

// the sentence battery (groups F and G) runs with the other groups in tests/search-nl.test.ts

test("stopped, draws, streaks and runs are read as the fact they name (round 53)", () => {
  const p = (q: string) => ai.heuristicParse(q, countries, T);
  assert.deepEqual(p("fighters who have never been knocked out"), { maxStopped: 0 });
  assert.deepEqual(p("boxers who have never been stopped"), { maxStopped: 0 });
  assert.deepEqual(p("fighters stopped more than twice"), { minStopped: 3 });
  assert.deepEqual(p("fighters knocked out twice"), { minStopped: 2 });
  assert.deepEqual(p("fighters stopped exactly once"), { minStopped: 1, maxStopped: 1 });
  assert.deepEqual(p("boxers who lost by knockout at least 3 times"), { minStopped: 3 }, "it had been '3 or more fights'");
  assert.deepEqual(p("fighters with at most 1 KO loss"), { maxStopped: 1 }, "a KO loss is not a win by knockout");
  assert.deepEqual(p("fighters with 5 or more KO losses"), { minStopped: 5 });
  assert.deepEqual(p("fighters who have knocked out at least 10 opponents"), { minKOs: 10 }, "the active voice counts wins by knockout");
  assert.deepEqual(p("fighters who went the distance every time"), { maxStopped: 0, maxKOs: 0 });
  assert.deepEqual(p("fighters with a draw"), { minDraws: 1 });
  assert.deepEqual(p("fighters with no draws"), { maxDraws: 0 });
  assert.deepEqual(p("fighters who never fought a draw"), { maxDraws: 0 });
  assert.deepEqual(p("fighters with exactly 2 draws"), { minDraws: 2, maxDraws: 2 });
  assert.deepEqual(p("fighters with fewer than 2 draws"), { maxDraws: 1 });
  assert.deepEqual(p("fighters on a winning streak of at least 5"), { minWinStreak: 5 });
  assert.deepEqual(p("fighters on a 4 fight winning streak"), { minWinStreak: 4 }, "it had been '4 or more fights'");
  assert.deepEqual(p("fighters on a three fight losing streak"), { minLossStreak: 3 });
  assert.deepEqual(p("fighters on a winning streak"), { minWinStreak: 2 }, "a streak is two or more");
  assert.deepEqual(p("fighters who have won their last 3"), { minWinStreak: 3 });
  assert.deepEqual(p("boxers who lost their last two"), { minLossStreak: 2 });
  assert.deepEqual(p("fighters who lost their last fight"), { minLossStreak: 1 });
  assert.deepEqual(p("fighters who lost their last fight by knockout"), { text: "fighters who lost their last fight by knockout" }, "how the last fight ended is not a filter: not everyone who lost");
  assert.equal(p("boxers who won their last 3 fights by decision").minWinStreak, undefined);
  assert.deepEqual(p("fighters with no KO loss"), { maxStopped: 0 }, "singular");
  assert.deepEqual(p("fighters who have stopped 10 boxers"), { minKOs: 10 });
  assert.deepEqual(p("fighters who have stopped 10 rivals"), { minKOs: 10 });
  assert.deepEqual(p("fighters who go the distance every time"), { maxStopped: 0, maxKOs: 0 });
  assert.deepEqual(p("fighters who never been stopped"), { maxStopped: 0 });
  assert.equal(p("boxers who lost their last fight against a champion").minLossStreak, undefined, "against whom is not a filter either");
  assert.deepEqual(p("fighters unbeaten in their last 5"), { unbeatenIn: 5 }, "it had been 'undefeated'");
  assert.deepEqual(p("fighters who haven't lost in their last 4"), { unbeatenIn: 4 });
  assert.deepEqual(p("boxers unbeaten over their last 6 fights"), { unbeatenIn: 6 });
  assert.deepEqual(p("undefeated fighters"), { undefeated: true }, "and plain 'undefeated' is still that");
  assert.deepEqual(p("fighters with a ko rate under 30%"), { maxKoRate: 0.3 });
  assert.equal(p("the longest winning streak").minWinStreak, undefined, "'longest winning streak' is a list, not a filter");
});

test("when a fighter last fought is read from the league's own date", () => {
  const p = (q: string) => ai.heuristicParse(q, countries, T);
  assert.deepEqual(p("fighters who fought in the last 6 months"), { lastFightAfter: "2026-04-03" });
  assert.deepEqual(p("boxers who have fought in the past year"), { lastFightAfter: "2025-10-03" });
  assert.deepEqual(p("fighters who fought within the last 3 months"), { lastFightAfter: "2026-07-03" });
  assert.deepEqual(p("fighters who fought in the last 2 weeks"), { lastFightAfter: "2026-09-19" });
  assert.deepEqual(p("fighters who fought this year"), { lastFightAfter: "2026-01-01" });
  assert.deepEqual(p("fighters who fought last year"), { lastFightAfter: "2025-01-01", lastFightBefore: "2025-12-31" });
  assert.deepEqual(p("fighters who have not fought in over a year"), { lastFightBefore: "2025-10-02" }, "over a year is before the day a year ago");
  assert.deepEqual(p("fighters who haven't fought in at least 18 months"), { lastFightBefore: "2025-04-03" }, "at least keeps the day");
  assert.deepEqual(p("fighters inactive for 2 years"), { lastFightBefore: "2024-10-03" });
  assert.deepEqual(p("boxers who haven't been in a fight for more than 2 years"), { lastFightBefore: "2024-10-02" });
  assert.deepEqual(p("fighters who last fought in 2024"), { lastFightAfter: "2024-01-01", lastFightBefore: "2024-12-31" });
  assert.deepEqual(p("fighters who last fought before 2023"), { lastFightBefore: "2022-12-31" });
  assert.deepEqual(p("fighters who last fought after 2023"), { lastFightAfter: "2024-01-01" });
  assert.deepEqual(p("fighters who have fought since 2025"), { lastFightAfter: "2025-01-01" });
  assert.deepEqual(p("boxers who haven't fought since 2023"), { lastFightBefore: "2023-12-31" });
  assert.equal(ai.heuristicParse("fighters who fought in the last 6 months", countries).lastFightAfter, undefined, "no date to count back from, no filter invented");
});

test("the filters behave on the league's own fighters", () => {
  const all = w.boxers.filter((b) => b.bouts > 0);
  const f = (x: Parameters<typeof ai.applyFilters>[1]) => ai.applyFilters(all, x, w, {});
  assert.ok(f({ maxStopped: 0 }).every((b) => b.koLosses === 0));
  assert.equal(f({ maxStopped: 0 }).length + f({ minStopped: 1 }).length, all.length);
  assert.equal(f({ minDraws: 1 }).length + f({ maxDraws: 0 }).length, all.length);
  // a streak is the current run: nobody on a winning streak is on a losing one
  assert.equal(f({ minWinStreak: 1 }).filter((b) => b.streak.type === "L").length, 0);
  assert.ok(f({ minWinStreak: 1 }).length + f({ minLossStreak: 1 }).length < all.length + 1);
  // unbeaten in the last N asks the world; without one it matches nobody
  assert.ok(f({ unbeatenIn: 3 }).length > 0);
  assert.equal(ai.applyFilters(all, { unbeatenIn: 3 }).length, 0, "no world to look in: nobody, not everybody");
  // a fighter who has not fought has no last fight to compare
  const never = { ...all[0], lastFight: null } as typeof all[0];
  assert.equal(ai.applyFilters([never], { lastFightBefore: "2099-01-01" }, w).length, 0);
  assert.equal(ai.applyFilters([never], { lastFightAfter: "1900-01-01" }, w).length, 0);
  // a knockout rate needs a record to rest on: a fighter with no wins is not under 30%
  const winless = { ...all[0], wins: 0, koRate: 0 } as typeof all[0];
  assert.equal(ai.applyFilters([winless], { maxKoRate: 0.3 }, w).length, 0);
});

test("the planner sends a record question to the fighter search and keeps the lists", () => {
  const first = (q: string) => rules.planByRules(q, w, {})[0];
  assert.deepEqual(first("who lost their last fight"), { tool: "fighters", args: { minLossStreak: 1 } }, "not the list of recent events");
  assert.deepEqual(rules.planByRules("who lost their last fight by knockout", w, {}), [], "no answer rather than everyone who lost");
  assert.deepEqual(first("which fighters have never been knocked out"), { tool: "fighters", args: { maxStopped: 0 } });
  assert.deepEqual(first("fighters who fought in the last 6 months"), { tool: "fighters", args: { lastFightAfter: "2026-04-03" } });
  assert.deepEqual(first("who is on the longest winning streak"), { tool: "record_list", args: { list: "win-streak" } }, "a list about streaks is still the list");
  assert.deepEqual(rules.planByRules("upcoming fights for fighters on a winning streak", w, {}), [], "no tool has both the events and the cut");
  assert.deepEqual(first("most wins among fighters who have never been knocked out"), { tool: "fighters", args: { maxStopped: 0, sort: "wins" } }, "a list cannot be cut by it: a search sorted the same way");
  assert.deepEqual(rules.planByRules("upcoming fights of fighters who have not fought in over a year", w, {}), [], "an events word and a cut on when they last fought");
  assert.deepEqual(rules.planByRules("fighters with the most draws", w, {}), [], "no list of draws: no answer, not fighters with a draw");
  assert.deepEqual(rules.planByRules("who has drawn the most", w, {}), []);
  assert.equal(first("when did Marcus Larkin last fight")?.tool, "fighter", "a named fighter's last fight is still that fact");
});

test("the model's filters are checked, and the chips say what was understood in both languages", async () => {
  const j = ai.sanitizeFilters({ maxStopped: 0, minDraws: 1, minWinStreak: 3, unbeatenIn: 5, lastFightAfter: "2026-01-01", lastFightBefore: "soon", minBogus: 4 }, countries);
  assert.deepEqual((await ai.parseQuery("fighters who fought in the last 6 months", w)).filters, { lastFightAfter: "2026-04-03" }, "the search box counts back from the league's own date");
  assert.deepEqual(j, { maxStopped: 0, minDraws: 1, minWinStreak: 3, unbeatenIn: 5, lastFightAfter: "2026-01-01" }, "a date that is not a date is dropped");
  assert.deepEqual(ai.describeFilters({ maxStopped: 0, maxDraws: 0, minWinStreak: 3, minLossStreak: 2, unbeatenIn: 5, lastFightAfter: "2026-01-01", lastFightBefore: "2026-06-30" }),
    ["Never stopped", "No draws", "Win streak ≥ 3", "Losing streak ≥ 2", "Unbeaten in last 5", "Last fought since Jan 1, 2026", "Last fought by Jun 30, 2026"]);
  // dates are written in the visitor's language, not as 2026-07-04 (which a right-to-left page shows as 04-07-2026, a different date to read)
  const { makeT } = await import("../lib/i18n/t");
  const { dictOf } = await import("../lib/i18n/dicts");
  const arChips = ai.describeFilters({ lastFightAfter: "2026-07-04", lastFightBefore: "2025-01-31" }, makeT("ar", dictOf("ar")));
  assert.equal(arChips.length, 2);
  for (const c of arChips) assert.ok(!/\d{4}-\d{2}-\d{2}/.test(c) && /\d{4}/.test(c) && /[\u0600-\u06ff]{3,}\s*\d{1,2}\s|\d{1,2}\s+[\u0600-\u06ff]{3,}/.test(c), c);
  assert.deepEqual(ai.describeFilters({ minStopped: 3, maxStopped: 5, minDraws: 1, maxDraws: 2 }), ["Stopped ≥ 3 times", "Stopped ≤ 5 times", "Draws ≥ 1", "Draws ≤ 2"]);
  const ar = (await import("../lib/i18n/dicts")).dictOf("ar");
  for (const k of ["Never stopped", "No draws", "Stopped ≥ {n} times", "Stopped ≤ {n} times", "Draws ≥ {n}", "Draws ≤ {n}", "Win streak ≥ {n}", "Losing streak ≥ {n}", "Unbeaten in last {n}", "Last fought since {date}", "Last fought by {date}"]) assert.ok(typeof ar[k] === "string" && ar[k] !== k, k);
});
