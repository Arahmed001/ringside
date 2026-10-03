import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * The live ledger writes a prediction down before each fight and grades it afterwards. What makes it worth showing is
 * that nothing can be backdated or edited: rows are append-only, a fight is graded on the last prediction made strictly
 * before its event, and a fight we never predicted is never claimed. The league and calendar here are hand-made so every
 * rule can be exercised by moving the app's clock.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("ledger", "2026-03-01");
after(cleanup);

const PAIRS = [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"], ["A", "D"], ["B", "C"]];
interface Result { winner: "red" | "blue" | "draw" | null }
const feedWith = (x: Result, y: Result): FeedData => {
  const feed = miniFeed();
  feed.boxers = ["A", "B", "C", "D"].map((id) => makeBoxer(id));
  feed.people = []; feed.orgs = []; feed.stints = []; feed.weighIns = []; feed.officials = []; feed.scorecards = []; feed.corners = []; feed.punches = [];
  feed.events = []; feed.bouts = [];
  PAIRS.forEach(([red, blue], i) => {
    const d = new Date(Date.UTC(2025, 0, 10) + i * 61 * 86400000).toISOString().slice(0, 10);
    feed.events.push({ externalId: `H${i}`, name: `History ${i}`, date: d, venue: "Arena", city: "Reno", country: "United States" });
    feed.bouts.push({ externalId: `HB${i}`, eventExternalId: `H${i}`, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12, winnerExternalId: i % 3 === 0 ? blue : red, method: "UD", endRound: 12, title: null, position: 0 });
  });
  feed.events.push({ externalId: "FUT", name: "Future Night", date: "2026-03-10", venue: "Arena", city: "Reno", country: "United States" });
  const result = (r: Result, red: string, blue: string) => ({
    winnerExternalId: r.winner === "red" ? red : r.winner === "blue" ? blue : null,
    method: r.winner === null ? null : r.winner === "draw" ? "DRAW" as const : "UD" as const, endRound: r.winner === null ? null : 12,
  });
  const base = { eventExternalId: "FUT", weightClass: "Lightweight", rounds: 12, title: null };
  feed.bouts.push(
    { externalId: "X", redExternalId: "A", blueExternalId: "B", position: 0, ...base, ...result(x, "A", "B") },
    { externalId: "Y", redExternalId: "C", blueExternalId: "D", position: 1, ...base, ...result(y, "C", "D") },
    { externalId: "Z", redExternalId: "A", blueExternalId: "D", position: 2, ...base, ...result({ winner: null }, "A", "D"), status: "cancelled" as const },
  );
  return feed;
};

let wm: typeof import("../lib/world");
let L: typeof import("../lib/ledger");
let db: import("node:sqlite").DatabaseSync;
let ingest: typeof import("../lib/ingest").ingest;
before(async () => { wm = await import("../lib/world"); L = await import("../lib/ledger"); ingest = (await import("../lib/ingest")).ingest; db = await (await import("../lib/db")).getDb(); });

const setDay = async (day: string) => { process.env.RINGSIDE_NOW = day; wm.invalidateWorld(); return wm.getWorld(); };
const rows = () => db.prepare("SELECT * FROM prediction_snapshots ORDER BY bout_id, locked_on").all() as unknown as Record<string, unknown>[];
const boutId = (w: Awaited<ReturnType<typeof wm.getWorld>>, red: string) => w.bouts.find((b) => b.redName === `Fighter ${red}` && b.date === "2026-03-10")!.id;

test("every upcoming, not-cancelled bout is written down once a day, however often the world rebuilds", async () => {
  await ingest(db, providerOf(feedWith({ winner: null }, { winner: null })));
  let w = await setDay("2026-03-01");
  assert.equal(rows().length, 2, "X and Y; the cancelled bout and the history are not predicted");
  w = await setDay("2026-03-01"); w = await wm.getWorld();
  assert.equal(rows().length, 2, "rebuilding on the same day adds nothing");
  w = await setDay("2026-03-02");
  assert.equal(rows().length, 4, "a new day appends a new snapshot for each; the old ones stay");
  assert.deepEqual([...new Set(rows().map((r) => r.locked_on))], ["2026-03-01", "2026-03-02"]);
  assert.ok(w.bouts.some((b) => b.status === "cancelled"));
});

test("a snapshot is the live model's own number, with its inputs and the weights' fingerprint", async () => {
  const { predict } = await import("../lib/predict");
  const w = await setDay("2026-03-02");
  const x = w.boutById.get(boutId(w, "A"))!, red = w.byId.get(x.redId)!, blue = w.byId.get(x.blueId)!;
  const p = predict(red, blue);
  const row = rows().find((r) => r.bout_id === x.id && r.locked_on === "2026-03-02")!;
  assert.ok(Math.abs((row.p_red as number) - p.pA / (p.pA + p.pB)) < 1e-12);
  assert.ok(Math.abs((row.ko_prob as number) - p.koProb) < 1e-12);
  assert.equal(row.model, L.modelVersion());
  const inputs = JSON.parse(row.inputs as string);
  assert.ok(inputs.red.rating > 0 && inputs.blue.reachCm > 0 && inputs.weights.rating > 0, "enough to reproduce the call");
  assert.match(String(row.locked_at), /^\d{4}-\d{2}-\d{2}T/);
});

test("graded on the LAST snapshot strictly before the event; later results never rewrite what was predicted", async () => {
  const before = rows().map((r) => JSON.stringify(r));
  await ingest(db, providerOf(feedWith({ winner: "red" }, { winner: "draw" })));
  // an in-between and an after-the-event snapshot that must be ignored
  const w = await setDay("2026-03-11");
  const xId = boutId(w, "A");
  const ins = db.prepare("INSERT INTO prediction_snapshots (bout_id, locked_on, locked_at, model, p_red, p_draw, ko_prob, elo_p_red, inputs) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run(xId, "2026-03-10", new Date().toISOString(), "forged", 0.99, 0.03, 0.5, 0.5, "{}"); // taken ON the event date: too late
  ins.run(xId, "2026-03-12", new Date().toISOString(), "forged", 0.01, 0.03, 0.5, 0.5, "{}"); // after the event
  const rec = L.liveRecord(db, w);
  assert.equal(rec.locked, 2);
  assert.equal(rec.graded.n, 1, "X is graded; Y was a draw");
  assert.equal(rec.voided, 1, "the draw has nothing to grade");
  const call = rec.calls[0];
  assert.equal(call.boutId, xId); assert.equal(call.lockedOn, "2026-03-02", "the last snapshot before 10 March, not the forged ones");
  assert.notEqual(call.model, "forged");
  assert.equal(call.redWon, true);
  assert.equal(call.pRed, (rows().find((r) => r.bout_id === xId && r.locked_on === "2026-03-02")!.p_red as number));
  const original = rows().filter((r) => r.model !== "forged").map((r) => JSON.stringify(r));
  assert.deepEqual(original.slice(0, before.length), before, "no earlier row changed when the results and ratings did");
  assert.equal(rows().filter((r) => (r.locked_on as string) > "2026-03-02" && r.model !== "forged").length, 0, "nothing is written for a fight that has been decided");
});

test("the same prediction, a different result: only the grade moves", async () => {
  await ingest(db, providerOf(feedWith({ winner: "blue" }, { winner: "draw" })));
  const w = await setDay("2026-03-11");
  const rec = L.liveRecord(db, w);
  const c = rec.calls[0];
  assert.equal(c.redWon, false);
  assert.equal(c.correct, c.pickedRed === false);
  assert.equal(c.pWinner, 1 - c.pRed);
});

test("a fight we never predicted is not claimed: one that first appears already decided, or only after its date", async () => {
  const w = await setDay("2026-03-11");
  const rec = L.liveRecord(db, w);
  assert.ok(!rec.calls.some((c) => w.boutById.get(c.boutId)!.date < "2026-03-10"), "none of the history is in the live record");
  assert.equal(rec.locked, 2);
  // a bout whose only snapshot is dated on/after the event is skipped, not graded
  const lone = w.bouts.find((b) => b.redName === "Fighter C" && b.date === "2025-01-10" + "")?.id ?? w.bouts[0].id;
  db.prepare("INSERT INTO prediction_snapshots (bout_id, locked_on, locked_at, model, p_red, p_draw, ko_prob, elo_p_red, inputs) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(lone, w.boutById.get(lone)!.date, new Date().toISOString(), "late", 0.9, 0.03, 0.5, 0.5, "{}");
  const again = L.liveRecord(db, w);
  assert.ok(!again.calls.some((c) => c.boutId === lone), "a prediction made on the day of the fight is too late to count");
});

test("pending: upcoming fights on file, soonest first, with the latest probability; and the summary reuses the backtest's arithmetic", async () => {
  db.exec("DELETE FROM prediction_snapshots WHERE model IN ('forged', 'late')"); // the forgeries from the earlier tests
  await ingest(db, providerOf(feedWith({ winner: null }, { winner: null })));
  const w = await setDay("2026-03-05");
  const rec = L.liveRecord(db, w);
  assert.deepEqual(rec.pending.map((p) => [p.eventDate, p.snapshots >= 1]), [["2026-03-10", true], ["2026-03-10", true]]);
  assert.equal(rec.pending[0].lockedOn, "2026-03-05");
  assert.equal(rec.graded.n, 0);
  assert.equal(L.lockedFor(db, rec.pending[0].boutId)?.lockedOn, "2026-03-05");
  assert.equal(L.lockedFor(db, 999999), null);
});

test("a ledger failure never breaks the pages: with the table gone, the world still builds", async () => {
  db.exec("ALTER TABLE prediction_snapshots RENAME TO prediction_snapshots_off");
  try {
    const w = await setDay("2026-03-06");
    assert.ok(w.boxers.length === 4, "the world built without a ledger");
  } finally { db.exec("ALTER TABLE prediction_snapshots_off RENAME TO prediction_snapshots"); }
});
