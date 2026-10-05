import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeFeed, MAX_SCHEDULED_ROUNDS } from "../lib/validate";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * Historical fights were scheduled for 20, 25 or more rounds. A feed that has them must keep them (a dropped fight
 * takes a real result out of both fighters' records), while an absurd value (a hundred rounds) is still a data error.
 * The knockout-by-round charts show rounds 1 to 12 and fold every later stoppage into a "12+" column.
 */
const TODAY = "2026-10-03";
const run = (rounds: number, endRound: number | null) => {
  const f = miniFeed(); f.bouts[0].rounds = rounds; f.bouts[0].endRound = endRound;
  return sanitizeFeed(f, { today: TODAY });
};

test("a 20-round fight, ended in round 18, is kept; the ceiling is a number, and a bout past it is dropped and named", () => {
  const ok = run(20, 18);
  assert.equal(ok.feed.bouts.length, 1);
  assert.deepEqual(ok.issues.filter((i) => i.severity === "error"), []);
  assert.equal(run(MAX_SCHEDULED_ROUNDS, 30).feed.bouts.length, 1, "exactly the ceiling is allowed");
  const bad = run(MAX_SCHEDULED_ROUNDS + 1, null);
  assert.equal(bad.feed.bouts.length, 0);
  assert.ok(bad.issues.some((i) => i.code === "bad_round"));
  assert.equal(run(100, null).feed.bouts.length, 0, "a hundred rounds is still a data error");
  assert.equal(run(12, 13).feed.bouts.length, 0, "ending after the scheduled distance is still rejected");
});

const cleanup = tempDb("long-fights");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-long-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;

before(async () => {
  const feed = miniFeed();
  feed.boxers = [makeBoxer("A", "Heavyweight"), makeBoxer("B", "Heavyweight"), makeBoxer("C", "Heavyweight"), makeBoxer("D", "Heavyweight")];
  const bouts: [string, string, string, number, number, string][] = [
    ["2025-01-01", "A", "B", 12, 12, "1"], // KO in round 12: the last cell
    ["2025-02-01", "A", "C", 20, 18, "2"], // a 20-rounder stopped in round 18: folds into the last cell
    ["2025-03-01", "B", "D", 15, 14, "3"], // a 15-rounder stopped in round 14: folds into the last cell
    ["2025-04-01", "C", "D", 12, 3, "4"],  // round 3
  ];
  feed.events = bouts.map(([date, , , , , n]) => ({ externalId: `EV${n}`, name: `Card ${n}`, date, venue: "Arena", city: "Reno", country: "United States" }));
  feed.bouts = bouts.map(([, r, u, rounds, end, n]) => ({
    externalId: `B${n}`, eventExternalId: `EV${n}`, redExternalId: r, blueExternalId: u, weightClass: "Heavyweight", rounds, winnerExternalId: r, method: "KO",
    endRound: end, title: null, position: 1,
  }) as never);
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
});

test("stoppages after round 12 fold into the last column of the charts: no gap, no NaN, nothing dropped", async () => {
  const A = await import("../lib/analytics");
  assert.equal(w.bouts.length, 4, "every long fight is in the world");
  const hist = A.finishRoundHistogram(w);
  assert.equal(hist.length, A.FINISH_ROUNDS, "twelve cells, however long the fight");
  assert.deepEqual([hist[2], hist[11]], [1, 3], "round 3 once; rounds 12, 14 and 18 together in the last cell");
  assert.equal(hist.reduce((a, b) => a + b, 0), 4, "every stoppage is counted once");
  const heat = A.finishHeat(w).find((r) => r.weightClass === "Heavyweight")!;
  assert.equal(heat.cells.length, A.FINISH_ROUNDS);
  assert.equal(heat.total, 4);
  assert.ok(heat.cells.every((c) => Number.isFinite(c)), "no NaN");
  assert.equal(heat.cells[11], 0.75);
  assert.equal(heat.cells[2], 0.25);
});
