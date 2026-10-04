import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-leaguewide");
after(cleanup);
let rules: typeof import("../lib/ask/rules");
let ai: typeof import("../lib/ai");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { rules = await import("../lib/ask/rules"); ai = await import("../lib/ai"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, {});

test("a grouping of the league, a share, and 'unranked' are no answer, not the whole league (round 69)", () => {
  for (const q of ["how many fighters are there in each division", "which division has the oldest fighters", "which division has the most knockouts", "division with the most champions", "how many fighters are unranked", "what percentage of fighters are southpaws", "what is the most common stance", "which division is the deepest"]) assert.deepEqual(plan(q), [], q);
});

test("a per-division list that already is one keeps its answer, and a count of one group is still a count", () => {
  assert.equal(plan("Please show me the champions of every weight class")[0]?.tool, "champions");
  assert.equal(plan("rankings in every division")[0]?.tool, "rankings");
  assert.deepEqual(plan("how many fighters are in the heavyweight division"), [{ tool: "fighters", args: { weightClass: "Heavyweight" } }]);
  assert.deepEqual(plan("how many southpaws are there"), [{ tool: "fighters", args: { stance: "Southpaw" } }]);
});

test("'debuted this year' and 'turned pro last year' are the year of the debut", () => {
  const yr = +w.today.slice(0, 4);
  assert.deepEqual(ai.heuristicParse("how many fighters debuted this year", [], w.today), { debutAfter: yr, debutBefore: yr });
  assert.deepEqual(ai.heuristicParse("fighters who turned pro last year", [], w.today), { debutAfter: yr - 1, debutBefore: yr - 1 });
  assert.equal(ai.heuristicParse("fighters who debuted this year", []).debutAfter, undefined, "no date to count from, no year invented");
  const n = w.boxers.filter((b) => b.bouts > 0 && b.turnedPro === yr).length;
  assert.equal(ai.applyFilters(w.boxers.filter((b) => b.bouts > 0), { debutAfter: yr, debutBefore: yr }, w).length, n);
});
