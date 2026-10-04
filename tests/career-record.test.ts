import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

process.env.RINGSIDE_NO_SEED = "1";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const cleanup = tempDb("career-record");
after(cleanup);

/**
 * A partial load must not publish a wrong record. The data supplier states each fighter's career total; when Ringside holds fewer fights than that, the page shows
 * the supplier's total, labelled, and builds everything else from the fights held. These tests cover the rule, and the whole path: adapter, database, world.
 */
const rec = (wins: number, losses: number, draws = 0) => ({ wins, losses, draws });

test("careerView: the supplier's total is shown only when the loaded fights give fewer of something and more of nothing", async () => {
  const { careerView, recordStr } = await import("../lib/world");
  assert.deepEqual(careerView({ ...rec(1, 0), vendorRecord: rec(19, 0, 1) }), { wins: 19, losses: 0, draws: 1, source: "supplier", total: 20, held: 1 }, "1-0 held of a 19-0-1 career");
  assert.equal(careerView({ ...rec(19, 0, 1), vendorRecord: rec(19, 0, 1) }).source, "loaded", "they agree");
  assert.equal(careerView({ ...rec(3, 1), vendorRecord: null }).source, "loaded", "the supplier gave no total");
  assert.equal(careerView(rec(3, 1)).source, "loaded", "a fighter object with no supplier field at all");
  assert.equal(careerView({ ...rec(5, 0), vendorRecord: rec(4, 0) }).source, "loaded", "more wins loaded than the total: the supplier's total trails its results, and a page does not pick a side");
  assert.equal(careerView({ ...rec(2, 3), vendorRecord: rec(4, 2) }).source, "loaded", "fewer wins but more losses: a contradiction, not a partial history");
  assert.equal(careerView({ ...rec(2, 0, 0), vendorRecord: rec(2, 0, 1) }).source, "supplier", "a missing draw alone is partial");
  assert.equal(recordStr({ ...rec(1, 0), vendorRecord: rec(19, 0, 1) }), "19-0-1");
  assert.equal(recordStr(rec(7, 2, 1)), "7-2-1");
});

test("end to end: a partial load keeps the supplier's totals and every record shown is the supplier's", async () => {
  const { makeWorld, mockVendor } = await import("../lib/vendor-mock");
  const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const { getWorld, recordStr, careerView } = await import("../lib/world");
  const world = makeWorld({ fighters: 120, fights: 260, upcoming: 3, seed: 21 });
  const v = mockVendor(world);
  const provider = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: v.fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, maxFighters: 40, log: () => {}, sleep: async () => {} });
  const db = await getDb();
  await ingest(db, provider, { strict: false });

  const rows = db.prepare("SELECT external_id, vendor_wins w, vendor_losses l, vendor_draws d FROM boxers").all() as { external_id: string; w: number; l: number; d: number }[];
  assert.equal(rows.length, 40);
  for (const r of rows) {
    const truth = world.careers.get(r.external_id.replace("bda-f-", "")) ?? rec(0, 0, 0);
    assert.deepEqual([r.w, r.l, r.d], [truth.wins, truth.losses, truth.draws], `${r.external_id}: the supplier's total is stored as given`);
  }

  const w = await getWorld();
  let partial = 0, complete = 0;
  const byExt = new Map((db.prepare("SELECT id, external_id FROM boxers").all() as { id: number; external_id: string }[]).map((r) => [r.id, r.external_id]));
  for (const b of w.boxers) {
    const truth = world.careers.get(byExt.get(b.id)!.replace("bda-f-", "")) ?? rec(0, 0, 0);
    assert.equal(recordStr(b), `${truth.wins}-${truth.losses}-${truth.draws}`, `${b.name}: the page shows the career record, partial history or not`);
    if (careerView(b).source === "supplier") partial++; else complete++;
  }
  assert.ok(partial > 0, "the selection left some fighters with fewer fights than their career (otherwise this tests nothing)");
  assert.ok(complete > 0, "and some whose loaded fights are all of it");
});

test("a fighter the supplier gave no total for has no stored total, and shows the loaded record", async () => {
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const db = await getDb();
  const before = (db.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c;
  const provider = {
    name: "t",
    fetchBoxers: async () => [{ externalId: "x-1", name: "No Total", country: "US", birthYear: null, stance: null, heightCm: null, reachCm: null, weightClass: "Welterweight", turnedPro: null, active: true }],
    fetchEvents: async () => [], fetchBouts: async () => [],
  };
  await ingest(db, provider as never, { strict: false });
  const r = db.prepare("SELECT vendor_wins w FROM boxers WHERE external_id = 'x-1'").get() as { w: number | null };
  assert.equal(r.w, null);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c, before + 1);
});
