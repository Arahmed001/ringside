import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-rating");
after(cleanup);
let ai: typeof import("../lib/ai");
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { ai = await import("../lib/ai"); rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); });
const p = (q: string) => ai.heuristicParse(q, [], w.today);
const plan = (q: string) => rules.planByRules(q, w, {});

test("a rating as shown is a filter, and the question is not answered with everyone (round 65)", () => {
  assert.deepEqual(p("fighters rated above 1600"), { minRating: 1601 });
  assert.deepEqual(p("a rating of at least 1650"), { minRating: 1650 });
  assert.deepEqual(p("fighters with a rating under 1500"), { maxRating: 1499 });
  assert.deepEqual(p("rated between 1550 and 1500"), { minRating: 1500, maxRating: 1550 });
  assert.deepEqual(p("welterweights with an Elo over 1600"), { weightClass: "Welterweight", minRating: 1601 });
  assert.deepEqual(p("ملاكمون تصنيفهم أكثر من 1600"), { minRating: 1601 });
  assert.deepEqual(p("ملاكمون بتصنيف 1650 فأكثر"), { minRating: 1650 });
  assert.deepEqual(p("ملاكمون تصنيفهم بين 1500 و1550"), { minRating: 1500, maxRating: 1550 });
  assert.equal(p("fighters with 1600 wins").minRating, undefined, "a number with no rating word is not a rating");
});

test("the filter is the rating the page shows, rounded", () => {
  const all = w.boxers.filter((b) => b.bouts > 0);
  const n = all.filter((b) => Math.round(b.rating) >= 1600).length;
  assert.ok(n > 0 && n < all.length);
  assert.equal(ai.applyFilters(all, { minRating: 1600 }, w).length, n);
  assert.equal(ai.applyFilters(all, { maxRating: 1599 }, w).length, all.length - n);
  assert.deepEqual(ai.describeFilters({ minRating: 1600, maxRating: 1700 }), ["Rating ≥ 1600", "Rating ≤ 1700"]);
  assert.deepEqual(ai.sanitizeFilters({ minRating: 1600, maxRating: "x" }, []), { minRating: 1600 });
});

test("sorting words, and questions about rank movement or the worst champion", () => {
  assert.deepEqual(plan("rank the welterweights by knockouts"), [{ tool: "fighters", args: { weightClass: "Welterweight", sort: "kos" } }], "it had been sorted by rating");
  assert.equal(plan("sort fighters by reach")[0].args.sort, "reach");
  assert.equal(plan("sort the heavyweights by knockout")[0].args.sort, "kos", "the singular");
  assert.equal(p("who is rated highest").sort, "rating");
  assert.equal(plan("list heavyweights by age")[0].args.sort, "age");
  for (const q of ["who climbed the rankings the most", "who dropped out of the top 10", "in the rankings, who climbed the most", "who is the lowest rated champion", "which champion has the lowest rating"]) assert.deepEqual(plan(q), [], q);
  assert.equal(plan("who is the best champion")[0]?.tool, "champions");
});
