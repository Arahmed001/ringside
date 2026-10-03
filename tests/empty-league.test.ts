import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { league, sweepAggregates, sweepAskTools } from "./league-sweep";

const cleanupDb = tempDb("empty-league");
let cleanup = () => {};
after(() => { cleanup(); cleanupDb(); });
let w: Awaited<ReturnType<typeof league>>["w"];
before(async () => { const l = await league("empty"); w = l.w; cleanup = l.cleanup; });

test("the empty league loads", () => {
  assert.equal(w.boxers.length, 0);
  assert.equal(w.bouts.length, 0);
});

test("every aggregate of the empty league returns without throwing and without a NaN", async () => {
  assert.deepEqual(await sweepAggregates(w), []);
});

test("every Ask-the-data tool answers about the empty league with a finished sentence and sound tables", async () => {
  const { bad, runs } = await sweepAskTools(w);
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} problems in ${runs} runs`);
  assert.ok(runs > 100);
});
