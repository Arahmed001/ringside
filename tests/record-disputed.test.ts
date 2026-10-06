import test, { after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tempDb } from "./helpers";
import fs from "node:fs";
import os from "node:os";

process.env.RINGSIDE_NO_SEED = "1";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const cleanup = tempDb("record-disputed");
after(cleanup);

/**
 * Round 89, the "disputed" label. On the first real cache about 2% of fighters had a loaded record ABOVE the vendor's own career total (a duplicated or non-professional
 * bout in its list, a stale total, a wrong winner: the fights cannot say which), Mayweather among them. Dropping them was the safe answer; `--keep-disputed` keeps them and marks
 * them, and a marked fighter's page shows the vendor's total and says the two disagree.
 */
const rec = (wins: number, losses: number, draws = 0) => ({ wins, losses, draws });

test("careerView: a marked fighter shows the vendor's total whichever way the loaded record differs, and only a marked one", async () => {
  const { careerView, koView, careerCounts, recordStr } = await import("../lib/world");
  const held = { ...rec(53, 0, 0), bouts: 56, kos: 30, koRate: 30 / 53, koLosses: 0, vendorRecord: { ...rec(50, 0, 0), koWins: 27, stopped: 0 } };
  assert.equal(careerView(held).source, "loaded", "unmarked: more loaded than the vendor's total, a page does not pick a side (as before)");
  const marked = { ...held, recordDisputed: true };
  assert.deepEqual(careerView(marked), { wins: 50, losses: 0, draws: 0, source: "disputed", total: 50, held: 53 });
  assert.equal(recordStr(marked), "50-0-0");
  assert.deepEqual(koView(marked), { kos: 27, rate: 27 / 50, stopped: 0, source: "supplier" }, "the vendor's knockouts go with the vendor's total");
  assert.deepEqual(careerCounts(marked), { wins: 50, losses: 0, draws: 0, bouts: 50 });
  assert.equal(careerView({ ...marked, vendorRecord: null }).source, "loaded", "marked but the vendor gave no total: nothing to show instead");
  assert.equal(careerView({ ...marked, recordDisputed: false }).source, "loaded");
  // partial and disputed are different: a marked fighter's own fights may be fewer than the total in one count and more in another
  assert.equal(careerView({ ...rec(2, 3), vendorRecord: rec(4, 2), recordDisputed: true }).source, "disputed", "fewer wins but more losses: the contradiction case");
});

test("end to end: --keep-disputed marks survive the database and the world, a re-load can clear a mark, and a daily update leaves it alone", async () => {
  const { makeWorld, mockVendor, degradeWorld } = await import("../lib/vendor-mock");
  const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const { getWorld, careerView, recordStr } = await import("../lib/world");
  const league = degradeWorld(makeWorld({ fighters: 400, fights: 3000, upcoming: 0, seed: 17 }), { seed: 4, wrongTotals: 5 });
  const wrong = new Set((league.faults?.wrongTotals ?? []).map((id) => `bda-f-${id}`));
  assert.ok(wrong.size >= 3);
  const provider = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: mockVendor(league).fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {} });
  const withMarks = (marks: (id: string) => boolean | undefined) => ({ ...provider, fetchBoxers: async () => (await provider.fetchBoxers()).map((b) => { const m = marks(b.externalId); return m === undefined ? b : { ...b, recordDisputed: m }; }) });
  const db = await getDb();
  await ingest(db, withMarks((id) => wrong.has(id)), { strict: false });
  const w = await getWorld();
  const marked = w.boxers.filter((b) => b.recordDisputed);
  assert.ok(marked.length >= 3, `${marked.length} marked fighters kept`);
  for (const b of marked) {
    const c = careerView(b);
    assert.equal(c.source, "disputed"); assert.equal(recordStr(b), `${b.vendorRecord!.wins}-${b.vendorRecord!.losses}-${b.vendorRecord!.draws}`, "the page shows the vendor's total");
  }
  const col = (db.prepare("SELECT COUNT(*) c FROM boxers WHERE record_disputed = 1").get() as { c: number }).c;
  assert.equal(col, marked.length);
  // a daily update sends no mark: it stays
  await ingest(db, withMarks(() => undefined), { strict: false });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers WHERE record_disputed = 1").get() as { c: number }).c, col, "an update that says nothing leaves the marks");
  // a re-load that marks nobody (the conflict has gone) clears them
  await ingest(db, withMarks(() => false), { strict: false });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers WHERE record_disputed = 1").get() as { c: number }).c, 0, "false clears the mark");
});

test("--keep-disputed does not combine with the other answers to a conflict", () => {
  const bad = (extra: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/vendor-backfill.ts", "--check", "--keep-disputed", ...extra], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, BOXING_API_KEY: "k".repeat(40), RINGSIDE_NO_SEED: "1", RINGSIDE_LOCK_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "rd-locks-")) }, encoding: "utf8" });
  for (const other of ["--drop-conflicts", "--allow-conflicts", "--complete-only"]) {
    const r = bad([other]);
    assert.notEqual(r.status, 0, other); assert.match(r.stdout + r.stderr, /--keep-disputed keeps the fighters whose records contradict the feed and marks them: not with/, other);
  }
});
