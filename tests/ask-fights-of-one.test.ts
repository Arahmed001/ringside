import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { tEn } from "../lib/i18n/t";

const cleanup = tempDb("ask-fights-of-one");
after(cleanup);
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let rules: typeof import("../lib/ask/rules");
let ask: typeof import("../lib/ask").askData;
before(async () => { w = await (await import("../lib/world")).getWorld(); rules = await import("../lib/ask/rules"); ask = (await import("../lib/ask")).askData; });
const star = () => [...w.boxers].filter((b) => w.boxers.filter((x) => x.name === b.name).length === 1 && ![...w.people.values()].some((p) => p.name === b.name)).sort((a, b) => b.bouts - a.bouts || a.id - b.id)[0];
const plan = (q: string) => rules.planByRules(q, w, {});
const done = (b: World["boxers"][number]) => (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC");

test("one fighter's fights are his bouts, not his profile (round 68)", async () => {
  const b = star();
  assert.deepEqual(plan(`list ${b.name}'s fights`), [{ tool: "bouts", args: { fighter: b.name } }]);
  assert.deepEqual(plan(`show ${b.name}'s last 5 fights`), [{ tool: "bouts", args: { fighter: b.name, limit: 5 } }]);
  assert.equal(plan(`${b.name}'s last fight`)[0].args.about, "last_fight", "one fight is still the fact");
  assert.equal(plan(`${b.name}'s next fight`)[0].args.about, "next_fight");
  const a = await ask(`show ${b.name}'s last 5 fights`, { w, t: tEn, names: {} });
  assert.match(a.answer, new RegExp(`${done(b).length} fights match`), "his own fights, all of them counted");
});

test("with a year the fighter stays in the question", async () => {
  const b = star();
  const year = done(b)[0].date.slice(0, 4);
  const n = done(b).filter((x) => x.date.startsWith(year)).length;
  assert.deepEqual(plan(`who did ${b.name} fight in ${year}`), [{ tool: "bouts", args: { year: +year, fighter: b.name } }], "it had been every fight of the year");
  assert.deepEqual(plan(`how many fights did ${b.name} have in ${year}`), [{ tool: "bouts", args: { fighter: b.name, year: +year } }], "it had been his whole record");
  const a = await ask(`how many fights did ${b.name} have in ${year}`, { w, t: tEn, names: {} });
  assert.match(a.answer, new RegExp(`${n} fights? match`));
});

test("split, majority and unanimous decisions are those methods; knockdowns of a card are no answer", () => {
  assert.deepEqual(plan("how many split decisions"), [{ tool: "bouts", args: { method: "SD" } }], "it had been every decision");
  assert.deepEqual(plan("how many majority decisions"), [{ tool: "bouts", args: { method: "MD" } }]);
  assert.deepEqual(plan("how many unanimous decisions in 2025"), [{ tool: "bouts", args: { year: 2025, method: "UD" } }]);
  assert.deepEqual(plan("how many decisions in 2025"), [{ tool: "bouts", args: { year: 2025, method: "decision" } }]);
  assert.deepEqual(plan("how many knockdowns in the last card"), []);
  assert.equal(plan("which fights had the most knockdowns")[0]?.args.list, "knockdowns");
});

test("a count of one fighter's year keeps the fighter, the year and the kind; knockouts of a year are no answer", () => {
  const b = star();
  const year = done(b)[0].date.slice(0, 4);
  assert.deepEqual(plan(`how many title fights did ${b.name} have in ${year}`), [{ tool: "bouts", args: { year: +year, fighter: b.name, title: true } }], "it had been all his fights");
  assert.deepEqual(plan(`how many decisions did ${b.name} have in ${year}`), [{ tool: "bouts", args: { year: +year, fighter: b.name, method: "decision" } }], "it had been his career fact");
  assert.deepEqual(plan(`how many knockouts did ${b.name} score in ${year}`), [], "his wins by knockout cannot be told from his losses in that list");
  assert.equal(plan(`how many knockouts does ${b.name} have`)[0].args.about, "knockouts", "career knockouts are still the fact");
  assert.equal(plan(`how many fights has ${b.name} had`)[0].args.about, "record");
  assert.equal(plan(`list ${b.name}'s upcoming fights`)[0].args.about, "next_fight", "and his coming fights are the next-fight fact");
  assert.equal(plan(`show ${b.name}'s next fights`)[0].args.about, "next_fight");
});
