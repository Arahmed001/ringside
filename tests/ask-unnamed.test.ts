import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-unnamed");
after(cleanup);
let ai: typeof import("../lib/ai");
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { ai = await import("../lib/ai"); rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, {});

test("a question about one person whose name is not recognised is no answer, not a list (round 66)", () => {
  for (const q of ["is larkin retired", "is zzyzx active", "was smithers undefeated", "has quillfeather retired", "is larkin a southpaw", "is larkin orthodox", "is larkin champion", "is larkin a champion"]) assert.deepEqual(plan(q), [], q);
  assert.equal(plan("is everyone retired")[0]?.tool, "fighters", "'everyone' is not a name: that stays a list");
  assert.deepEqual(plan("retired heavyweights"), [{ tool: "fighters", args: { weightClass: "Heavyweight", active: false } }], "a plain list is still a list");
  assert.deepEqual(plan("undefeated fighters"), [{ tool: "fighters", args: { undefeated: true } }]);
});

test("'KO artists' is the knockout-artist style", () => {
  assert.equal(ai.heuristicParse("show me KO artists", []).archetype, "Knockout Artist");
  assert.equal(ai.heuristicParse("welterweight ko artist", []).archetype, "Knockout Artist");
});

test("a quality the data does not hold is no answer, not the best-rated fighter", () => {
  for (const q of ["best defensive fighter", "who has the best footwork", "who has the best stamina", "greatest heart in boxing", "who is the toughest fighter", "who has the best conditioning", "who has the best hand speed", "who has the best cardio", "who has the best defence"]) assert.deepEqual(plan(q), [], q);
  assert.equal(plan("fastest knockout ever")[0]?.args.list, "fastest-kos", "the fastest knockout is still a list");
  assert.equal(plan("what is the best welterweight")[0]?.tool, "fighters");
});
