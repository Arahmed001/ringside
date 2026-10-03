import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * The facts behind one visitor's picks: only the bouts they ask about, with status, winner and the model's call as
 * written down in the ledger before the fight (the last snapshot strictly before the event). Bounded and tolerant of junk.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("picks-api", "2026-03-01");
after(cleanup);

const feedFor = (xWinner: "A" | "B" | null, yDraw: boolean): FeedData => {
  const feed = miniFeed();
  feed.boxers = ["A", "B", "C", "D"].map((id) => makeBoxer(id));
  feed.people = []; feed.orgs = []; feed.stints = []; feed.weighIns = []; feed.officials = []; feed.scorecards = []; feed.corners = []; feed.punches = [];
  feed.events = [
    { externalId: "H", name: "History", date: "2025-01-10", venue: "Arena", city: "Reno", country: "United States" },
    { externalId: "FUT", name: "Future Night", date: "2026-03-10", venue: "Arena", city: "Reno", country: "United States" },
    { externalId: "OLD", name: "Old Night", date: "2026-02-01", venue: "Arena", city: "Reno", country: "United States" },
  ];
  const base = { weightClass: "Lightweight", rounds: 12, title: null, position: 0 };
  feed.bouts = [
    { externalId: "H1", eventExternalId: "H", redExternalId: "A", blueExternalId: "B", winnerExternalId: "A", method: "UD", endRound: 12, ...base },
    { externalId: "H2", eventExternalId: "H", redExternalId: "C", blueExternalId: "D", winnerExternalId: "D", method: "UD", endRound: 12, ...base },
    { externalId: "X", eventExternalId: "FUT", redExternalId: "A", blueExternalId: "B", winnerExternalId: xWinner, method: xWinner ? "UD" : null, endRound: xWinner ? 12 : null, ...base },
    { externalId: "Y", eventExternalId: "FUT", redExternalId: "C", blueExternalId: "D", winnerExternalId: null, method: yDraw ? "DRAW" : null, endRound: yDraw ? 12 : null, ...base },
    { externalId: "Z", eventExternalId: "FUT", redExternalId: "A", blueExternalId: "D", winnerExternalId: null, method: null, endRound: null, status: "cancelled", ...base },
    { externalId: "W", eventExternalId: "OLD", redExternalId: "B", blueExternalId: "C", winnerExternalId: null, method: null, endRound: null, ...base }, // past, no result in
  ];
  return feed;
};

let wm: typeof import("../lib/world");
let route: typeof import("../app/api/picks/route");
let db: import("node:sqlite").DatabaseSync;
let ingest: typeof import("../lib/ingest").ingest;
before(async () => { wm = await import("../lib/world"); route = await import("../app/api/picks/route"); ingest = (await import("../lib/ingest")).ingest; db = await (await import("../lib/db")).getDb(); });

const setDay = async (d: string) => { process.env.RINGSIDE_NOW = d; wm.invalidateWorld(); return wm.getWorld(); };
const ask = async (ids: string, lang = "en") => (await route.GET(new Request(`http://x/api/picks?ids=${ids}&lang=${lang}`))).json() as Promise<import("../lib/picks-grade").PickInfo[]>;
const idOf = (w: Awaited<ReturnType<typeof wm.getWorld>>, ext: { red: string; date: string }) => w.bouts.find((b) => b.redName === `Fighter ${ext.red}` && b.date === ext.date)!.id;

test("statuses: upcoming, awaiting a result, decided, void and cancelled; the model's call is the last snapshot before the event", async () => {
  await ingest(db, providerOf(feedFor(null, false)));
  let w = await setDay("2026-03-01");
  w = await setDay("2026-03-02"); // two days of snapshots
  const x = idOf(w, { red: "A", date: "2026-03-10" }), y = idOf(w, { red: "C", date: "2026-03-10" }), z = w.bouts.find((b) => b.status === "cancelled")!.id, old = idOf(w, { red: "B", date: "2026-02-01" });
  const rows = await ask([x, y, z, old].join(","));
  const by = new Map(rows.map((r) => [r.boutId, r]));
  assert.equal(by.get(x)!.status, "upcoming"); assert.equal(by.get(y)!.status, "upcoming");
  assert.equal(by.get(z)!.status, "cancelled"); assert.equal(by.get(old)!.status, "awaiting", "the date has passed but no result is in");
  const snap = db.prepare("SELECT p_red FROM prediction_snapshots WHERE bout_id = ? AND locked_on = '2026-03-02'").get(x) as { p_red: number };
  assert.equal(by.get(x)!.modelPRed, snap.p_red, "the latest snapshot");
  assert.equal(by.get(z)!.modelPRed, null, "a cancelled bout was never predicted");
  assert.equal(by.get(x)!.red.name, "Fighter A"); assert.equal(by.get(x)!.eventName, "Future Night");
});

test("after the fights: decided with a winner, a draw is void; a snapshot taken on or after the event never becomes the call", async () => {
  await ingest(db, providerOf(feedFor("B", true)));
  const w = await setDay("2026-03-11");
  const x = idOf(w, { red: "A", date: "2026-03-10" }), y = idOf(w, { red: "C", date: "2026-03-10" });
  const forged = db.prepare("INSERT INTO prediction_snapshots (bout_id, locked_on, locked_at, model, p_red, p_draw, ko_prob, elo_p_red, inputs) VALUES (?,?,?,?,?,?,?,?,?)");
  forged.run(x, "2026-03-10", new Date().toISOString(), "forged", 0.01, 0.03, 0.5, 0.5, "{}");
  forged.run(x, "2026-03-12", new Date().toISOString(), "forged", 0.02, 0.03, 0.5, 0.5, "{}");
  const rows = await ask(`${x},${y}`);
  const rx = rows.find((r) => r.boutId === x)!, ry = rows.find((r) => r.boutId === y)!;
  assert.equal(rx.status, "decided"); assert.equal(rx.winnerId, rx.blue.id, "B won");
  assert.equal(ry.status, "void"); assert.equal(ry.winnerId, null);
  assert.ok(rx.modelPRed !== null && rx.modelPRed > 0.05, "the forged 1% and 2% rows dated on and after the event are ignored");
  const { grade } = await import("../lib/picks-grade");
  const g = grade({ [x]: rx.red.id, [y]: ry.red.id }, rows);
  assert.deepEqual([g.rows.find((r) => r.info.boutId === x)!.state, g.rows.find((r) => r.info.boutId === y)!.state], ["wrong", "void"]);
});

test("junk is tolerated and the request is bounded: bad ids dropped, duplicates collapsed, unknown fights skipped, capped at 200", async () => {
  const w = await setDay("2026-03-11");
  const real = w.bouts[0].id;
  assert.deepEqual(await ask(""), []);
  assert.deepEqual(await ask("abc,-1,0,1.5,,999999"), [], "nothing valid, nothing found");
  const rows = await ask(`${real},${real},${real},abc,999999`);
  assert.equal(rows.length, 1, "one fight once");
  const many = Array.from({ length: 5000 }, (_, i) => i + 1).join(",");
  assert.ok((await ask(many)).length <= 200);
});

test("names and event are in the requested language", async () => {
  const w = await setDay("2026-03-11");
  const rows = await ask(String(w.bouts[0].id), "ar");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].red.name.length > 0 && rows[0].eventName.length > 0);
});
