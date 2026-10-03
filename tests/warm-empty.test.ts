import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { league } from "./league-sweep";

// the first start of a real deployment has nobody in the database: warming must not turn that into a failed start-up
const cleanupDb = tempDb("warm-empty");
let cleanup = () => {};
after(() => { cleanup(); cleanupDb(); });
let w: Awaited<ReturnType<typeof league>>["w"];
before(async () => { const l = await league("empty"); w = l.w; cleanup = l.cleanup; });

test("warming an empty league: every step finishes without an error", async () => {
  const { warmAggregates, WARM_STEPS } = await import("../lib/warm");
  const results = await warmAggregates(w);
  assert.equal(results.length, WARM_STEPS.length);
  assert.deepEqual(results.filter((r) => r.error), []);
});
