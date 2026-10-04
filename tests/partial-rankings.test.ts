import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

process.env.RINGSIDE_NO_SEED = "1";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const cleanup = tempDb("partial-rankings");
after(cleanup);

/**
 * A ranking needs five fights, and the rankings count only the fights Ringside holds. A league loaded in stages holds each fighter's most recent fights, so for a
 * while almost nobody qualifies. Measured on a league shaped like the real feed (35,235 fighters, 44,265 fights, the 5,000 most recent taken): 0 fighters ranked in
 * any division, 0 in pound-for-pound. The pages must say so, not show blank cards.
 */
test("a league loaded in part: almost nobody qualifies yet, the depth says most careers are partial, and a full load has none", async () => {
  const { makeWorld, mockVendor } = await import("../lib/vendor-mock");
  const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const { getWorld } = await import("../lib/world");
  const { rankDivision, pound4pound, rankingDepth } = await import("../lib/rankings");
  const league = makeWorld({ fighters: 3000, fights: 3700, upcoming: 4, seed: 8, today: "2026-10-03" });
  const make = (maxFighters?: number) => boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: mockVendor(league).fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, maxFighters, log: () => {}, sleep: async () => {} });
  const db = await getDb();
  await ingest(db, make(500), { strict: false });
  const w = await getWorld();
  assert.equal(w.boxers.length, 500);
  const divisions = [...new Set(w.boxers.map((b) => b.weightClass))];
  const ranked = divisions.reduce((n, d) => n + rankDivision(w, d, 1000).length, 0);
  assert.ok(ranked <= 5, `almost nobody has the five loaded fights a ranking needs: ${ranked} of 500 are ranked`);
  assert.ok(pound4pound(w, 50).length <= 1, "and nobody has the eight that pound-for-pound needs");
  assert.ok(rankingDepth(w).partialShare > 0.5, `most careers are partial (${rankingDepth(w).partialShare.toFixed(2)})`);

  // the whole league: every career is whole, so the note does not appear
  db.exec("DELETE FROM bouts; DELETE FROM events; DELETE FROM boxers;");
  await ingest(db, make(), { strict: false });
  const full = await getWorld();
  assert.ok(full.boxers.length > 2000);
  assert.ok(rankingDepth(full).partialShare < 0.01, `${rankingDepth(full).partialShare}`);
});

test("rankingDepth is zero for a league with no supplier totals (the demo league, a file feed)", async () => {
  const { rankingDepth } = await import("../lib/rankings");
  const { getWorld } = await import("../lib/world");
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  db.exec("UPDATE boxers SET vendor_wins = NULL, vendor_losses = NULL, vendor_draws = NULL");
  db.exec("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES ('2026-10-03', 'test', 0, 0, 0, '{}', '{}')");
  assert.equal(rankingDepth(await getWorld()).partialShare, 0);
});
