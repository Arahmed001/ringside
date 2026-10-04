import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-groupings");
after(cleanup);
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, {});

test("a grouping no tool makes is no answer, not a look-alike (round 60)", () => {
  for (const q of ["which venue hosted the most fights", "which city has hosted the most events", "which country has the most champions", "which countries have produced the most champions", "how many fights ended before round 5", "which country has the most fighters", "how many fights ended in the first round", "knockouts in round 3"]) assert.deepEqual(plan(q), [], q);
});

test("the team filter wins over a fighter who is also named like the trainer", () => {
  const trainer = [...w.people.values()].find((p) => (w.stintsByPerson.get(p.id) ?? []).some((s) => s.role === "head_trainer"))!.name;
  assert.deepEqual(plan(`how many fighters trained by ${trainer}`), [{ tool: "fighters", args: { trainer } }]);
  const manager = [...w.people.values()].find((p) => (w.stintsByPerson.get(p.id) ?? []).some((s) => s.role === "manager"))?.name;
  if (manager) assert.deepEqual(plan(`how many fighters are managed by ${manager}`), [{ tool: "fighters", args: { manager } }]);
  const promoter = [...w.orgs.values()].find((o) => (w.stintsByOrg.get(o.id) ?? []).some((s) => s.role === "promoter"))?.name;
  if (promoter) assert.deepEqual(plan(`fighters promoted by ${promoter}`), [{ tool: "fighters", args: { promoter } }]);
  assert.equal(plan("which trainer has the best win rate")[0]?.args.name, undefined, "a sentence is not a trainer's name (it had been \"has the best win rate\")");
  assert.equal(plan("who are the best trainers")[0]?.tool, "trainers", "and the trainers are still the trainers tool");
  assert.equal(plan("Which venues have the biggest gates?")[0]?.tool, "money", "a venue with a gate is the gates list");
  assert.equal(plan(`trainer impact of ${trainer}`)[0]?.tool, "trainers", "a trainer asked about by name is still the trainers tool");
});

test("scheduled rounds are the tool's minimum, or no answer", () => {
  assert.deepEqual(plan("how many title fights were scheduled for 12 rounds"), [{ tool: "bouts", args: { title: true, minRounds: 12 } }]);
  assert.deepEqual(plan("how many fights were scheduled for at least 10 rounds"), [{ tool: "bouts", args: { minRounds: 10 } }]);
  assert.deepEqual(plan("how many fights were scheduled for 8 rounds"), [], "exactly 8 is not something the tool can say");
});
