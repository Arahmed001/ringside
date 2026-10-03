import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";

/** Streak notes on a league small enough to read: who is on a streak, whose unbeaten run ended, who was stopped for the first time. */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("recap-streaks", "2026-06-01");
after(cleanup);

const SCHEDULE: [string, string, "red" | "blue", "UD" | "KO"][] = [
  ["A", "B", "red", "UD"], ["A", "C", "red", "UD"], ["A", "D", "red", "UD"], ["A", "E", "red", "UD"], ["A", "B", "red", "UD"],
  ["A", "C", "blue", "KO"], // A's first defeat after 5 wins, stopped
  ["A", "D", "blue", "KO"], // A has lost two in a row
  ["B", "E", "red", "UD"], ["B", "E", "red", "UD"],
  ["B", "D", "blue", "KO"], // B stopped for the first time, after 4 fights
];
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let R: typeof import("../lib/recap");
before(async () => {
  const feed = miniFeed();
  feed.boxers = ["A", "B", "C", "D", "E"].map((id) => makeBoxer(id));
  feed.people = []; feed.orgs = []; feed.stints = []; feed.weighIns = []; feed.officials = []; feed.scorecards = []; feed.corners = []; feed.punches = []; feed.events = []; feed.bouts = [];
  SCHEDULE.forEach(([red, blue, win, method], i) => {
    const d = new Date(Date.UTC(2025, 0, 10) + i * 40 * 86400000).toISOString().slice(0, 10);
    feed.events.push({ externalId: `E${i}`, name: `Night ${i}`, date: d, venue: "Arena", city: "Reno", country: "United States" });
    feed.bouts.push({ externalId: `B${i}`, eventExternalId: `E${i}`, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12, winnerExternalId: win === "red" ? red : blue, method, endRound: method === "KO" ? 4 : 12, title: null, position: 0 });
  });
  const { ingest } = await import("../lib/ingest");
  await ingest(await (await import("../lib/db")).getDb(), providerOf(feed));
  w = await (await import("../lib/world")).getWorld();
  R = await import("../lib/recap");
});

const recapN = (i: number) => R.buildRecap(w, w.bouts.find((b) => b.eventName === `Night ${i}`)!.id)!;
const nameOf = (id: number) => w.byId.get(id)!.name;

test("a win streak is counted including the fight, and an unbeaten run ends with a clear note", () => {
  assert.equal(recapN(4).winStreak, 5, "A's fifth win in a row");
  assert.equal(nameOf(recapN(4).winnerId), "Fighter A");
  const first = recapN(5); // A loses to C
  assert.equal(nameOf(first.loserId), "Fighter A");
  assert.equal(first.loserUnbeatenEnded, 5, "five fights without a defeat are over");
  assert.equal(first.loserFirstStoppage, null, "the unbeaten run is the story, not the stoppage");
  assert.equal(first.loserLossStreak, 1); assert.equal(first.winStreak, 1);
});

test("consecutive defeats are counted, and a second stoppage is not 'the first'", () => {
  const second = recapN(6);
  assert.equal(nameOf(second.loserId), "Fighter A");
  assert.equal(second.loserLossStreak, 2); assert.equal(second.loserUnbeatenEnded, null); assert.equal(second.loserFirstStoppage, null);
});

test("the first time a fighter is stopped is noted once, with how many fights it took", () => {
  const stopped = recapN(9);
  assert.equal(nameOf(stopped.loserId), "Fighter B");
  assert.equal(stopped.loserFirstStoppage, 4, "B had fought four times, losing twice on points, before being stopped");
  assert.equal(stopped.loserLossStreak, 1, "two wins came in between");
  assert.equal(nameOf(stopped.winnerId), "Fighter D"); assert.equal(stopped.winStreak, 2, "D beat A, then B");
});

test("records after the fight are counted up to that fight and no further", () => {
  const r = recapN(5);
  const a = r.records.find((x) => x.id === r.loserId)!.rec, c = r.records.find((x) => x.id === r.winnerId)!.rec;
  assert.deepEqual([a.w, a.l, a.d, a.kos], [5, 1, 0, 0], "A after the first defeat, not after the second");
  assert.deepEqual([c.w, c.l, c.d, c.kos], [1, 1, 0, 1], "C: lost to A, then stopped A");
});

test("the sentences say it", async () => {
  const { tEn } = await import("../lib/i18n/t");
  const lines = R.recapLines(recapN(5), w, tEn);
  assert.ok(lines.some((l) => /unbeaten run of 5 fights is over/.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /Records now: Fighter C 1-1-0, Fighter A 5-1-0/.test(l)));
  assert.ok(R.recapLines(recapN(4), w, tEn).some((l) => /has now won 5 in a row/.test(l)));
  assert.ok(R.recapLines(recapN(6), w, tEn).some((l) => /has now lost 2 in a row/.test(l)));
  assert.ok(R.recapLines(recapN(9), w, tEn).some((l) => /first time .* has been stopped in 5 fights/.test(l)));
});
