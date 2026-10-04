import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-money-team");
after(cleanup);
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, {});

test("how many fighters does X train is the team filter, or no answer for a name nobody has (round 64)", () => {
  const trainer = [...w.people.values()].find((p) => (w.stintsByPerson.get(p.id) ?? []).some((s) => s.role === "head_trainer"))!.name;
  assert.deepEqual(plan(`how many fighters does ${trainer} train`), [{ tool: "fighters", args: { trainer } }]);
  assert.deepEqual(plan("how many fighters does Nobody Atall manage"), [], "not every fighter");
  assert.deepEqual(plan("how many fighters does Nobody Atall train"), []);
});

test("money by count, for one fighter or for a year, and who missed weight the most, are no answer", () => {
  const name = w.boxers.find((b) => b.bouts > 5)!.name;
  for (const q of ["how many pay-per-view events were there", "how many gates were over a million", "how many purses were reported", "who failed to make weight the most", "who came in over the weight limit the most", `how much did ${name} earn`, `what is ${name} worth`, "who is the top earner in 2025", "who missed weight the most", "which trainers have trained champions"]) assert.deepEqual(plan(q), [], q);
});

test("the lists keep their answers", () => {
  assert.equal(plan("who is the highest earner")[0]?.args.kind, "earners");
  assert.equal(plan("what is the biggest purse ever")[0]?.args.kind, "purses");
  assert.equal(plan("what was the largest gate")[0]?.args.kind, "gates");
  assert.deepEqual(plan("which fighters have missed weight"), [{ tool: "fighters", args: { missedWeight: true } }]);
});
