import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { makeT, tEn } from "../lib/i18n/t";
import fs from "node:fs";
import path from "node:path";

const cleanup = tempDb("ask-sort-more");
after(cleanup);
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let rules: typeof import("../lib/ask/rules");
let ai: typeof import("../lib/ai");
let ask: typeof import("../lib/ask").askData;
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8"));
before(async () => { w = await (await import("../lib/world")).getWorld(); rules = await import("../lib/ask/rules"); ai = await import("../lib/ai"); ask = (await import("../lib/ask")).askData; });
const plan = (q: string) => rules.planByRules(q, w, {});
const all = () => w.boxers.filter((b) => b.bouts > 0);
const first = (q: string, f?: (b: World["boxers"][number]) => boolean) => ai.applyFilters(all().filter(f ?? (() => true)), ai.heuristicParse(q, [], w.today), w, {})[0];

test("the other orders: lowest rating, lowest knockout rate, best record, most losses, draws, times stopped (round 72)", () => {
  assert.deepEqual(plan("lowest rated heavyweight"), [{ tool: "fighters", args: { weightClass: "Heavyweight", sort: "lowRating" } }], "it had been the highest rated");
  assert.deepEqual(plan("lowest knockout rate among fighters with 10 wins"), [{ tool: "fighters", args: { minWins: 10, sort: "lowKoRate" } }]);
  assert.deepEqual(plan("best record among fighters with 20 fights"), [{ tool: "fighters", args: { minBouts: 20, sort: "winRate" } }]);
  assert.deepEqual(plan("who has the most losses"), [{ tool: "fighters", args: { sort: "losses" } }]);
  assert.deepEqual(plan("who has the most losses by knockout"), [{ tool: "fighters", args: { sort: "stopped" } }]);
  assert.deepEqual(plan("who has been stopped the most"), [{ tool: "fighters", args: { sort: "stopped" } }]);
  assert.deepEqual(plan("fighter with the most draws"), [{ tool: "fighters", args: { sort: "draws" } }]);
  assert.equal(plan("the lowest rating among welterweights")[0].args.sort, "lowRating");
  assert.equal(plan("the lowest elo")[0].args.sort, "lowRating");
  assert.equal(plan("who has the best win rate among fighters with 20 fights")[0].args.sort, "winRate");
  assert.equal(plan("highest winning percentage with 10 fights")[0].args.sort, "winRate");
  assert.equal(plan("who has the most wins")[0].tool, "record_list", "the lists keep their questions");
  assert.equal(plan("who has the highest knockout rate")[0].tool, "record_list");
});

test("each order puts the right fighter first, from the league's own numbers", () => {
  const rated = all();
  assert.equal(first("lowest rated fighters").rating, Math.min(...rated.map((b) => b.rating)));
  assert.equal(first("who has the most losses").losses, Math.max(...rated.map((b) => b.losses)));
  assert.equal(first("fighter with the most draws").draws, Math.max(...rated.map((b) => b.draws)));
  assert.equal(first("who has been stopped the most").koLosses, Math.max(...rated.map((b) => b.koLosses)));
  const ten = rated.filter((b) => b.bouts >= 20);
  assert.equal(first("best record among fighters with 20 fights").winRate, Math.max(...ten.map((b) => b.winRate)));
  const wins = rated.filter((b) => b.wins >= 10);
  assert.equal(first("lowest knockout rate among fighters with 10 wins").koRate, Math.min(...wins.map((b) => b.koRate)));
  const noWins = { ...rated[0], wins: 0, koRate: 0 } as (typeof rated)[0];
  assert.notEqual(ai.applyFilters([noWins, rated.find((b) => b.wins > 3)!], { sort: "lowKoRate" }, w)[0], noWins, "a fighter with no wins has no knockout rate to be lowest");
});

test("rounds fought, and a single year, are no answer; the chips and the sentence name the order in both languages", async () => {
  for (const q of ["who has fought the most rounds", "which fighter has fought the fewest rounds", "total rounds fought by the heavyweights", "most knockouts in a single year", "most wins in a year", "most wins per year"]) assert.deepEqual(plan(q), [], q);
  assert.deepEqual(ai.describeFilters({ sort: "lowRating" }), ["Sorted by rating, lowest first"]);
  const a = await ask("who has the most losses", { w, t: tEn, names: {} });
  assert.match(a.answer, /by losses/);
  const ar = await ask("who has the most losses", { w, t: makeT("ar", AR), names: {} });
  assert.ok(/[؀-ۿ]/.test(ar.answer) && !/by losses/.test(ar.answer), ar.answer);
  for (const k of ["rating, lowest first", "KO rate, lowest first", "win rate", "losses", "draws", "times stopped"]) assert.ok(typeof AR[k] === "string", k);
});
