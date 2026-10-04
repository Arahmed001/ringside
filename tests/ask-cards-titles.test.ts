import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-cards-titles");
after(cleanup);
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, {});

test("the next main event is the next card (round 62)", () => {
  for (const q of ["what is the next main event", "who headlines the next card", "what is the biggest fight coming up"]) assert.deepEqual(plan(q), [{ tool: "events", args: { when: "upcoming" } }], q);
});

test("a count of coming cards, and a belt's kind or history, are no answer, not a look-alike", () => {
  for (const q of ["how many cards are scheduled this month", "how many events are upcoming", "how many cards are coming up", "how many fights does the next card have", "who is the interim champion", "list all vacant titles", "how many times has the IRA bantamweight title changed hands", "how many world titles are there"]) assert.deepEqual(plan(q), [], q);
});

test("what had an answer keeps it", () => {
  assert.equal(plan("who is the champion")[0]?.tool, "champions");
  assert.deepEqual(plan("how many events were there in 2024")[0], { tool: "events", args: { year: 2024 } });
  assert.equal(plan("how many upcoming fights are there")[0]?.tool, "events");
  assert.equal(plan("how many fights are coming up")[0]?.tool, "events");
});
