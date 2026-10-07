import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * The finish estimate reads the weight class. In the backtest it must be the division of THAT fight (a fighter who
 * moves up a division was not at the new weight for the earlier fights), and the ratings must be those before the fight.
 * The demo league never has a fighter change class, so this is checked on a hand-made league where they do.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("finish-division", "2026-10-03");
after(cleanup);

const feed = (): FeedData => {
  const f = miniFeed();
  f.boxers = ["A", "B", "C", "D"].map((id) => makeBoxer(id)); // all registered as Lightweight
  f.people = []; f.orgs = []; f.stints = []; f.weighIns = []; f.officials = []; f.scorecards = []; f.corners = []; f.punches = [];
  f.events = [
    { externalId: "E1", name: "One", date: "2024-01-10", venue: "Arena", city: "Reno", country: "United States" },
    { externalId: "E2", name: "Two", date: "2024-06-10", venue: "Arena", city: "Reno", country: "United States" },
    { externalId: "E3", name: "Three", date: "2024-09-10", venue: "Arena", city: "Reno", country: "United States" },
  ];
  const base = { rounds: 12, title: null, position: 0, method: "KO" as const, endRound: 3 };
  f.bouts = [
    { externalId: "B1", eventExternalId: "E1", redExternalId: "A", blueExternalId: "B", winnerExternalId: "A", weightClass: "Lightweight", ...base },
    { externalId: "B2", eventExternalId: "E1", redExternalId: "C", blueExternalId: "D", winnerExternalId: "D", weightClass: "Lightweight", ...base },
    { externalId: "B3", eventExternalId: "E2", redExternalId: "A", blueExternalId: "C", winnerExternalId: "A", weightClass: "Welterweight", ...base },
    { externalId: "B4", eventExternalId: "E3", redExternalId: "A", blueExternalId: "D", winnerExternalId: "D", weightClass: "Heavyweight", ...base },
  ];
  return f;
};

let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let M: typeof import("../lib/model");
let A: typeof import("../lib/accountability");
before(async () => {
  const db = await (await import("../lib/db")).getDb();
  await (await import("../lib/ingest")).ingest(db, providerOf(feed()));
  w = await (await import("../lib/world")).getWorld();
  M = await import("../lib/model"); A = await import("../lib/accountability");
});

test("each fight is scored at its own division, whatever class the fighters are registered at now", () => {
  const cs = A.callsForFit(w);
  const byExt = (red: string, date: string) => cs.find((c) => w.bouts.find((b) => b.id === c.boutId)!.date === date && w.byId.get(c.redId)!.name === `Fighter ${red}`)!;
  const welter = byExt("A", "2024-06-10"), heavy = byExt("A", "2024-09-10");
  assert.ok(welter && heavy, "both later fights are scored (both fighters had a fight before)");
  assert.equal(welter.finishX![3], M.weightScale(147), "Welterweight (147 lb), not the Lightweight the fighters are registered at");
  assert.notEqual(welter.finishX![3], M.weightScale(135));
  assert.equal(heavy.finishX![3], 1, "Heavyweight has no limit: the heaviest");
});

test("the mismatch input is the plain-Elo gap from the ratings before the fight, not after", () => {
  const cs = A.callsForFit(w);
  for (const c of cs) assert.ok(Math.abs(c.finishX![2] - Math.abs(2 * c.eloPRed - 1)) < 1e-12);
  // A beat B in the first fight, so before the second fight A's rating is above C's (who has not yet won)
  const welter = cs.find((c) => w.bouts.find((b) => b.id === c.boutId)!.date === "2024-06-10")!;
  assert.ok(welter.finishX![2] > 0, "a gap exists before the fight");
});
