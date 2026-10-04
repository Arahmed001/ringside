import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { nlCases, nlProblem } from "./search-nl-battery";

const cleanup = tempDb("search-nl");
after(cleanup);
let ai: typeof import("../lib/ai");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let countries: string[];

before(async () => {
  ai = await import("../lib/ai");
  w = await (await import("../lib/world")).getWorld();
  countries = [...new Set(w.boxers.map((b) => b.country))];
});

test("the sentence battery: a search returns exactly the fighters the sentence describes (round 51)", () => {
  const wrong: string[] = [];
  for (const c of nlCases()) {
    const found = ai.applyFilters(w.boxers.filter((b) => b.bouts > 0), ai.heuristicParse(c.q, countries, w.today), w, {});
    const p = nlProblem(w, c, found);
    if (p) wrong.push(`${c.q}: ${p}`);
  }
  assert.deepEqual(wrong, []);
});

test("the battery's truths are not empty or everyone: a search that ignored the sentence could not pass by luck", () => {
  const all = w.boxers.filter((b) => b.bouts > 0).length;
  const thin: string[] = [];
  for (const c of nlCases()) { const n = w.boxers.filter((b) => b.bouts > 0 && c.truth(b, w)).length; if (n === 0 || n === all) thin.push(`${c.q}: ${n} of ${all}`); }
  assert.deepEqual(thin, []);
});

test("numbers are read as the measure they count, and the comparison word keeps its direction", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.deepEqual(p("fighters with more than 10 losses"), { minLosses: 11 }, "10 losses is not 'undefeated' (the '0 losses' inside it)");
  assert.deepEqual(p("fighters with fewer than 3 losses"), { maxLosses: 2 });
  assert.deepEqual(p("fighters with exactly 4 losses"), { minLosses: 4, maxLosses: 4 });
  assert.deepEqual(p("boxers with 10 or fewer fights"), { maxBouts: 10 });
  assert.deepEqual(p("fighters with between 15 and 25 wins"), { minWins: 15, maxWins: 25 });
  assert.deepEqual(p("fighters with 20 to 30 wins"), { minWins: 20, maxWins: 30 });
  assert.deepEqual(p("fighters with 20 wins"), { minWins: 20 }, "a bare number is a minimum, as it always was");
  assert.deepEqual(p("boxers under 25"), { maxAge: 24 }, "under 25 is 24 and down");
  assert.deepEqual(p("boxers over 35"), { minAge: 36 });
  assert.deepEqual(p("boxers 30 years old"), { minAge: 30, maxAge: 30 });
  assert.deepEqual(p("fighters aged 30 to 35"), { minAge: 30, maxAge: 35 });
  assert.deepEqual(p("fighters over 6 feet"), { minHeight: 183 }, "6 feet is 182.88 cm, so over it is 183 and up");
  assert.deepEqual(p("fighters taller than 6 ft 2"), { minHeight: 188 });
  assert.deepEqual(p("boxers with a reach of at least 190"), { minReach: 190 });
  assert.deepEqual(p("boxers with a reach under 175"), { maxReach: 174 });
  assert.deepEqual(p("boxers with a reach between 180 and 190"), { minReach: 180, maxReach: 190 });
  assert.deepEqual(p("fighters who have lost more than 5 times"), { minLosses: 6 }, "'times' after 'lost' counts losses");
  assert.deepEqual(p("fighters who have fought more than 30 times"), { minBouts: 31 }, "and after 'fought' counts fights");
  assert.deepEqual(p("fighters with no losses"), { maxLosses: 0, undefeated: true });
  assert.deepEqual(p("fighters who never won by knockout"), { maxKOs: 0 });
  assert.deepEqual(p("winless fighters"), { maxWins: 0 });
  assert.deepEqual(p("heavyweights with a losing record"), { weightClass: "Heavyweight", record: "losing" });
  assert.deepEqual(p("fighters who turned pro in 2015"), { debutAfter: 2015, debutBefore: 2015 });
  assert.deepEqual(p("fighters who turned pro after 2015"), { debutAfter: 2016 });
  assert.deepEqual(p("fighters who turned pro before 2012"), { debutBefore: 2011 });
  assert.deepEqual(p("fighters who turned pro since 2015"), { debutAfter: 2015 });
});

test("rounding, repeated limits and the words that open a limit", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.deepEqual(p("fighters at least 6 feet tall"), { minHeight: 183 }, "6 feet is 182.88 cm: at least it is 183");
  assert.deepEqual(p("fighters 6 ft 2 or shorter"), { maxHeight: 187 }, "6 ft 2 is 187.96 cm: at most it is 187");
  assert.deepEqual(p("fighters with more than 10 wins and more than 20 wins"), { minWins: 21 }, "two minimums: the stricter stands");
  assert.deepEqual(p("fighters with fewer than 30 wins and fewer than 20 wins"), { maxWins: 19 }, "two maximums: the stricter stands");
  assert.deepEqual(p("fighters with more than 20 wins and more than 10 wins"), { minWins: 21 }, "whichever is said first");
  assert.deepEqual(p("fighters with fewer than 20 wins and fewer than 30 wins"), { maxWins: 19 });
  assert.deepEqual(p("fighters with 30 to 20 wins"), { minWins: 20, maxWins: 30 }, "a range said backwards is still a range");
  assert.deepEqual(p("fighters with between 30 and 20 wins"), { minWins: 20, maxWins: 30 });
  assert.deepEqual(p("fighters with no fewer than 10 wins"), { minWins: 10 });
  assert.deepEqual(p("fighters with no less than 10 wins"), { minWins: 10 });
  assert.deepEqual(p("fighters with no more than 10 wins"), { maxWins: 10 });
  assert.deepEqual(p("fighters with 15 or more fights"), { minBouts: 15 });
  assert.deepEqual(p("fighters with 15 or fewer fights"), { maxBouts: 15 });
});

test("a number that names a style, a rate, a rank or a year is not a count of anything", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.equal(p("top 5 knockout artists among women").minKOs, undefined, "'top 5 knockout artists' is a style, not 5 knockouts");
  assert.equal(p("top 5 knockout artists among women").archetype, "Knockout Artist");
  assert.equal(p("fighters with a knockout rate over 70%").minAge, undefined);
  assert.equal(p("ko percentage above 60 %").minAge, undefined, "60 % is a rate, not an age");
  assert.equal(p("fighters with a knockout rate over 70%").minKoRate, 0.7);
  assert.equal(p("fighters since 2018").minWins, undefined);
  assert.equal(p("boxers over 200 pounds").minAge, undefined, "200 is not an age");
  assert.equal(p("fighters over 70").minAge, undefined, "nor is 70: no boxer in a league is that old, so it is not read as one");
  assert.equal(p("top 10 knockouts").minKOs, undefined, "'top 10 knockouts' is a list of fights, not 10 knockouts");
  assert.equal(p("top 5 wins").minWins, undefined);
  assert.equal(p("boxers who were never stopped").sort, undefined, "'stopped' has a 'top' in it: it is not a request for the best");
  assert.equal(p("the top welterweights").sort, "rating");
  assert.equal(p("10 knockout artists").minKOs, undefined, "a style is not a count");
  assert.equal(p("10 knockout artists").archetype, "Knockout Artist");
});

test("champions: a qualifier on 'champions' is applied, never dropped", async () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.equal(p("champions from Mexico").champion, "current");
  assert.equal(p("former champions").champion, "former");
  assert.equal(p("retired champions").champion, "ever");
  assert.equal(p("retired champions").active, false);
  const live = ai.applyFilters(w.boxers.filter((b) => b.bouts > 0), { champion: "current" }, w, {});
  const ever = ai.applyFilters(w.boxers.filter((b) => b.bouts > 0), { champion: "ever" }, w, {});
  const former = ai.applyFilters(w.boxers.filter((b) => b.bouts > 0), { champion: "former" }, w, {});
  assert.ok(live.length > 0 && former.length > 0, "the league has both");
  assert.equal(live.length + former.length, ever.length, "ever is current plus former, with no one in both");
  assert.equal(ai.applyFilters(w.boxers, { champion: "current" }).length, 0, "without a world there is no belt to hold: nobody, not everybody");
  // "current" is the champions of live belts, the ones the champions page lists: a belt whose holder is inactive or whose last title fight was long ago does not count
  const { belts } = await import("../lib/lineage");
  const liveIds = new Set(belts(w).filter((b) => b.current && !b.stale).map((b) => b.current!.boxerId));
  const staleOnly = belts(w).filter((b) => b.current && b.stale).map((b) => b.current!.boxerId).filter((id) => !liveIds.has(id));
  assert.ok(staleOnly.length > 0, "the league has holders of dormant belts");
  const liveFound = new Set(live.map((b) => b.id));
  assert.deepEqual([...liveFound].sort(), [...liveIds].sort((a, b) => a - b).filter((id) => w.byId.get(id)!.bouts > 0).sort());
  assert.ok(staleOnly.every((id) => !liveFound.has(id)), "a dormant belt's holder is not a current champion");
});

test("the planner keeps each qualifier on the way to the fighter search", async () => {
  const { planByRules } = await import("../lib/ask/rules");
  const first = (q: string) => planByRules(q, w, {})[0];
  assert.deepEqual(first("champions from Mexico"), { tool: "fighters", args: { country: "Mexico", champion: "current" } });
  assert.deepEqual(first("former champions from Cuba"), { tool: "fighters", args: { country: "Cuba", champion: "former" } });
  assert.deepEqual(first("who are the current welterweight champions"), { tool: "champions", args: { division: "Welterweight" } }, "plain champions are still the champions list");
  assert.deepEqual(first("former champions"), { tool: "fighters", args: { champion: "former" } }, "the champions list shows live champions only");
  assert.equal(planByRules("longest reign among former champions", w, {}).length, 0, "a cut the champions' own list does not have is no answer, not the list for everybody");
  assert.equal(first("which champion defended his belt the most times")?.tool, "record_list", "a list about champions is not 'among champions'");
  assert.deepEqual(first("most wins among former champions"), { tool: "fighters", args: { champion: "former", sort: "wins" } });
  assert.deepEqual(first("most wins among fighters taller than 185 cm"), { tool: "fighters", args: { minHeight: 186, sort: "wins" } });
  assert.deepEqual(first("most wins among fighters with a reach under 175"), { tool: "fighters", args: { maxReach: 174, sort: "wins" } });
  assert.deepEqual(first("most wins among fighters with fewer than 5 losses"), { tool: "fighters", args: { maxLosses: 4, sort: "wins" } }, "a list that cannot be cut by losses is a search, not the list for everybody");
  assert.deepEqual(first("how many boxers have fought more than 30 times"), { tool: "fighters", args: { minBouts: 31 } });
});

test("the model's filters are checked too: new keys pass, bad ones do not", () => {
  const f = ai.sanitizeFilters({ maxLosses: 2, minBouts: 10, record: "winning", champion: "former", maxHeight: 180, record2: "x" }, countries);
  assert.deepEqual(f, { maxLosses: 2, minBouts: 10, record: "winning", champion: "former", maxHeight: 180 });
  assert.deepEqual(ai.sanitizeFilters({ record: "losing", champion: "ever" }, countries), { record: "losing", champion: "ever" });
  assert.deepEqual(ai.sanitizeFilters({ record: "even", champion: "yes", maxWins: "3" }, countries), {});
});

test("the chips under the search say what was understood, in both languages", async () => {
  const { tEn } = await import("../lib/i18n/t");
  const f = { maxLosses: 2, minBouts: 10, maxBouts: 30, record: "winning" as const, champion: "former" as const, maxReach: 180, minHeight: 183, maxHeight: 190, maxWins: 9, maxKOs: 3 };
  assert.deepEqual(ai.describeFilters(f), ["Former champions", "Winning record", "Wins ≤ 9", "KOs ≤ 3", "Losses ≤ 2", "Fights ≥ 10", "Fights ≤ 30", "Reach ≤ 180cm", "Height ≥ 183cm", "Height ≤ 190cm"]);
  assert.deepEqual(ai.describeFilters({ maxLosses: 0, undefeated: true }), ["Undefeated"], "no losses is one chip, not two");
  const ar = (await import("../lib/i18n/dicts")).dictOf("ar");
  for (const k of ["Former champions", "Has held a belt", "Winning record", "Losing record", "Wins ≤ {n}", "KOs ≤ {n}", "Losses ≤ {n}", "Fights ≥ {n}", "Fights ≤ {n}", "Reach ≤ {n}cm", "Height ≥ {n}cm", "Height ≤ {n}cm"]) assert.ok(typeof ar[k] === "string" && ar[k] !== k, k);
  void tEn;
});

test("a fact the data does not have never satisfies a limit on it", () => {
  const base = { id: 1, name: "X", wins: 5, losses: 1, kos: 2, bouts: 6, koRate: 0.4, rating: 1500, age: 30, active: true, sex: "male", country: "Mexico", weightClass: "Welterweight", stance: "Orthodox", turnedPro: 2015, nickname: null, birthPlace: null };
  const unknown = { ...base, id: 2, heightCm: null, reachCm: null } as unknown as import("../lib/types").BoxerFull;
  const known = { ...base, id: 3, heightCm: 175, reachCm: 175 } as unknown as import("../lib/types").BoxerFull;
  assert.deepEqual(ai.applyFilters([unknown, known], { maxHeight: 180 }).map((b) => b.id), [3]);
  assert.deepEqual(ai.applyFilters([unknown, known], { maxReach: 180 }).map((b) => b.id), [3]);
  assert.deepEqual(ai.applyFilters([unknown, known], { minHeight: 170 }).map((b) => b.id), [3]);
});
