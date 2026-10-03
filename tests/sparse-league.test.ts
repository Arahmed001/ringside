import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { league, sweepAggregates, sweepAskTools } from "./league-sweep";

const cleanupDb = tempDb("sparse-league");
let cleanup = () => {};
after(() => { cleanup(); cleanupDb(); });
let w: Awaited<ReturnType<typeof league>>["w"];
before(async () => { const l = await league("sparse"); w = l.w; cleanup = l.cleanup; });

test("the sparse league loads", () => {
  assert.equal(w.boxers.length, 2);
  assert.equal(w.bouts.length, 1);
});

test("every aggregate of the sparse league returns without throwing and without a NaN", async () => {
  assert.deepEqual(await sweepAggregates(w), []);
});

test("every Ask-the-data tool answers about the sparse league with a finished sentence and sound tables", async () => {
  const { bad, runs } = await sweepAskTools(w);
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} problems in ${runs} runs`);
  assert.ok(runs > 100);
});
