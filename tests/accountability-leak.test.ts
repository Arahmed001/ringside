import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * The guarantee behind the track record: a call is made from what was known before the fight. If a LATER result could
 * change an EARLIER call, the model would be grading itself with the answers in hand. A small league is ingested, then
 * re-ingested with one result changed, and the calls are compared fight by fight (the ratings are replayed from scratch
 * at every ingest, so this covers the whole pipeline, not just the scoring function).
 */
process.env.RINGSIDE_NO_SEED = "1"; // an empty database: this file builds its own league
const cleanup = tempDb("accountability-leak");
after(cleanup);

const PAIRS = [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"], ["A", "D"], ["B", "C"]];
const league = (winners: string[]): FeedData => {
  const feed = miniFeed();
  feed.boxers = ["A", "B", "C", "D"].map((id) => makeBoxer(id));
  feed.people = []; feed.orgs = []; feed.stints = []; feed.weighIns = []; feed.officials = []; feed.scorecards = []; feed.corners = []; feed.punches = [];
  feed.events = []; feed.bouts = [];
  winners.forEach((win, i) => {
    const [red, blue] = PAIRS[i % PAIRS.length];
    const d = new Date(Date.UTC(2024, 0, 10) + i * 61 * 86400000).toISOString().slice(0, 10);
    feed.events.push({ externalId: `E${i}`, name: `Night ${i}`, date: d, venue: "Arena", city: "Reno", country: "United States" });
    const ko = i % 2 === 0;
    feed.bouts.push({
      externalId: `B${i}`, eventExternalId: `E${i}`, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12,
      winnerExternalId: win === "red" ? red : blue, method: ko ? "KO" : "UD", endRound: ko ? 5 : 12, title: null, position: 0,
    });
  });
  return feed;
};
const WINNERS = ["red", "red", "blue", "red", "red", "blue", "blue", "red", "red", "blue", "red", "red"];

let wm: typeof import("../lib/world");
let A: typeof import("../lib/accountability");
let db: import("node:sqlite").DatabaseSync;
let ingest: typeof import("../lib/ingest").ingest;
before(async () => { wm = await import("../lib/world"); A = await import("../lib/accountability"); ingest = (await import("../lib/ingest")).ingest; db = await (await import("../lib/db")).getDb(); });

const callsFor = async (winners: string[]) => {
  await ingest(db, providerOf(league(winners)));
  wm.invalidateWorld();
  const w = await wm.getWorld();
  return A.calls(w).map((c) => ({ ...c }));
};
const key = (c: { date: string; redId: number; blueId: number }) => `${c.date}|${c.redId}|${c.blueId}`;

test("the league is scored: debuts are skipped, everything after them is", async () => {
  const base = await callsFor(WINNERS);
  assert.equal(base.length, WINNERS.length - 2, "the first two fights are debuts for all four fighters");
  assert.ok(base.every((c) => c.pRed > 0.04 && c.pRed < 0.96));
});

test("changing the LAST result leaves every earlier call exactly as it was", async () => {
  const base = await callsFor(WINNERS);
  const flipped = [...WINNERS]; flipped[flipped.length - 1] = flipped[flipped.length - 1] === "red" ? "blue" : "red";
  const after = await callsFor(flipped);
  assert.equal(after.length, base.length);
  for (let i = 0; i < base.length - 1; i++) assert.deepEqual(after[i], base[i], `call ${i} moved when a later fight was changed: the model saw the future`);
  const last = after[after.length - 1], was = base[base.length - 1];
  assert.equal(last.pRed, was.pRed, "even the last fight's own prediction cannot depend on its own result");
  assert.notEqual(last.redWon, was.redWon);
  assert.notEqual(last.correct, was.correct, "only its grade changes");
});

test("changing an EARLY result does change later calls (so the check above is not vacuous)", async () => {
  const base = await callsFor(WINNERS);
  const flipped = [...WINNERS]; flipped[0] = "blue"; // A-B: the first fight
  const after = await callsFor(flipped);
  assert.ok(after.some((c, i) => Math.abs(c.pRed - base[i].pRed) > 1e-6), "ratings carry the early result forward");
  const changedKeys = after.filter((c, i) => c.pRed !== base[i].pRed).map(key);
  assert.ok(changedKeys.length >= 1);
});

test("a result changed from a win to a no-contest or draw moves nothing before it", async () => {
  const base = await callsFor(WINNERS);
  const feed = league(WINNERS);
  const target = feed.bouts[feed.bouts.length - 1];
  target.winnerExternalId = null; target.method = "DRAW"; target.endRound = 12;
  await ingest(db, providerOf(feed));
  wm.invalidateWorld();
  const after = A.calls(await wm.getWorld());
  assert.equal(after.length, base.length - 1, "a draw is not scored");
  for (let i = 0; i < after.length; i++) assert.deepEqual({ ...after[i] }, base[i]);
});
