import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/** One fighter who changes head trainer once, with opponents who have none: every number can be checked by hand. */
const cleanupDb = tempDb("trainer-moves");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-moves-"));
after(() => { cleanupDb(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let TI: typeof import("../lib/trainer-impact");

before(async () => {
  const feed = miniFeed();
  feed.bouts = []; feed.events = []; feed.scorecards = []; feed.officials = []; feed.weighIns = []; feed.corners = []; feed.punches = []; feed.stints = [];
  feed.people = [{ externalId: "T1", name: "Trainer One" }, { externalId: "T2", name: "Trainer Two" }];
  feed.boxers = [makeBoxer("A"), ...Array.from({ length: 9 }, (_, i) => makeBoxer(`O${i}`))];
  feed.stints = [
    { boxerExternalId: "A", role: "head_trainer", personExternalId: "T1", start: "2017-01-01", end: "2020-01-01", source: "test" },
    { boxerExternalId: "A", role: "head_trainer", personExternalId: "T2", start: "2020-01-01", end: null, source: "test" },
  ];
  // three fights with T1 (a win, a win, a loss), then eight with T2 (only the first six count after the move)
  const dates = ["2018-02-01", "2018-08-01", "2019-03-01", "2020-03-01", "2020-06-01", "2020-09-01", "2020-12-01", "2021-03-01", "2021-06-01", "2021-09-01", "2021-12-01"];
  const results = ["A", "A", "O", "A", "A", "A", "A", "A", "A", "O", "A"];
  dates.forEach((d, i) => {
    const ev = `EV${i}`;
    feed.events.push({ externalId: ev, name: `Card ${i}`, date: d, venue: "Arena", city: "Reno", country: "United States" });
    feed.bouts.push({ externalId: `${ev}-b`, eventExternalId: ev, redExternalId: "A", blueExternalId: `O${i % 9}`, winnerExternalId: results[i] === "A" ? "A" : `O${i % 9}`, method: "UD", endRound: 12, title: null, position: 1, weightClass: "Lightweight", rounds: 12 } as never);
  });
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  TI = await import("../lib/trainer-impact");
});

const person = (name: string) => [...w.people.values()].find((p) => p.name === name)!;

test("a change of head trainer is one move, with the ratings on the day and after six fights", async () => {
  const { ratingAt } = await import("../lib/rankings");
  const mv = TI.moves(w);
  assert.equal(mv.length, 1);
  const m = mv[0];
  assert.equal(m.from!.name, "Trainer One"); assert.equal(m.to!.name, "Trainer Two");
  assert.equal(m.date, "2020-01-01");
  assert.equal(m.fightsBefore, 3);
  assert.equal(m.fightsAfter, 6, "capped at six even though eight fights followed");
  assert.equal(m.before, ratingAt(w, m.boxer.id, "2020-01-01"));
  assert.equal(m.after, ratingAt(w, m.boxer.id, "2021-06-01")); // the sixth fight after the move (2020-03, 06, 09, 12, 2021-03, 06)
  assert.ok(m.after! > m.before, "six wins in a row raise the rating");
});

test("moves are listed on both trainers' pages, as arrivals and departures", () => {
  const t1 = TI.movesOf(w, person("Trainer One").id), t2 = TI.movesOf(w, person("Trainer Two").id);
  assert.deepEqual([t1.arrived.length, t1.left.length, t2.arrived.length, t2.left.length], [0, 1, 1, 0]);
  const T = TI.trainerImpact(w);
  assert.deepEqual([T.byPerson.get(person("Trainer One").id)!.departures, T.byPerson.get(person("Trainer Two").id)!.arrivals], [1, 1]);
  assert.equal(T.switchers, 1);
});

test("too few moves means no switch study rather than a made-up number", () => {
  assert.equal(TI.switchStudy(w), null);
});
