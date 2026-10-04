import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-opponents");
after(cleanup);
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, {});

test("who beat someone is no answer, and not that fighter's profile (round 58)", () => {
  const name = w.boxers.find((b) => b.bouts > 5)!.name;
  for (const q of [`who has beaten ${name}`, `who beat ${name}`, `who defeated ${name}`, `who did ${name} lose to`, `who knocked out ${name}`]) assert.deepEqual(plan(q), [], q);
  assert.equal(plan(`tell me about ${name}`)[0]?.tool, "fighter", "a fighter's profile is still a fighter's profile");
});

test("a list that is about who beat the best keeps its answer", () => {
  assert.equal(plan("who has beaten the highest rated fighters")[0]?.tool, "record_list");
  assert.deepEqual(plan("who has beaten the most champions"), [], "no list of that: no answer, not the list of live champions");
  assert.equal(plan("who has the most wins")[0]?.tool, "record_list");
});

test("who trained or managed the most champions is no answer; who fought the most is a sort", () => {
  assert.deepEqual(plan("who trained the most champions"), []);
  assert.deepEqual(plan("which gym has the most champions"), []);
  assert.deepEqual(plan("who has fought the most times"), [{ tool: "fighters", args: { sort: "bouts" } }]);
});
