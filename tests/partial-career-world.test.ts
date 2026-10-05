import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

process.env.RINGSIDE_NO_SEED = "1";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const cleanup = tempDb("partial-career-world");
after(cleanup);

/**
 * Round 79, on a league loaded in part (500 of 3,000 fighters, so most careers are held in part): the filters and answers that compare careers use the career as the
 * fighter's page shows it. Before, "undefeated" listed fighters whose page said 14-1-1. (The all-time lists say they count "the fights on record", and still do.)
 */
test("on a league held in part, 'undefeated' and the record filters agree with the records the pages show", async () => {
  const { makeWorld, mockVendor } = await import("../lib/vendor-mock");
  const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const { getWorld, careerView } = await import("../lib/world");
  const { applyFilters } = await import("../lib/ai");
  const league = makeWorld({ fighters: 3000, fights: 3700, upcoming: 4, seed: 8, today: "2026-10-03" });
  const p = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: mockVendor(league).fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, sleep: async () => {}, log: () => {}, maxFighters: 500 });
  const db = await getDb();
  await ingest(db, p, { strict: false });
  const w = await getWorld();
  const part = w.boxers.filter((b) => careerView(b).source === "supplier");
  assert.ok(part.length > 100, `most careers are held in part (${part.length} of ${w.boxers.length})`);

  // undefeated: nobody whose page shows a loss, and everybody whose page shows none
  const shown = (b: (typeof w.boxers)[number]) => careerView(b);
  const undefeated = applyFilters(w.boxers, { undefeated: true }, w, {});
  assert.ok(undefeated.length > 0);
  assert.ok(undefeated.every((b) => shown(b).losses === 0), "no 'undefeated' fighter has a loss on his page");
  const missed = w.boxers.filter((b) => shown(b).losses === 0 && b.bouts > 0 && !undefeated.includes(b));
  assert.deepEqual(missed.map((b) => b.name), [], "and nobody with no loss on his page is missing");
  const heldNoLoss = w.boxers.filter((b) => b.losses === 0 && b.bouts > 0 && shown(b).losses > 0);
  assert.ok(heldNoLoss.length > 0, "the league does have fighters whose fights held hold no loss but whose career has one (what the old filter listed wrongly)");
});
