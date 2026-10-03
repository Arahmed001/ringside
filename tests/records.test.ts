import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/** Two champions: one retired mid-reign on a belt nobody has fought for since, one still active. */
const cleanupDb = tempDb("records");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-records-"));
after(() => { cleanupDb(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let R: typeof import("../lib/records");
let L: typeof import("../lib/lineage");

before(async () => {
  const feed = miniFeed();
  feed.bouts = []; feed.events = []; feed.scorecards = []; feed.officials = []; feed.weighIns = []; feed.corners = []; feed.punches = []; feed.stints = [];
  feed.boxers = [makeBoxer("OLD", "Lightweight", { active: false }), makeBoxer("NEW"), makeBoxer("X1"), makeBoxer("X2"), makeBoxer("X3")];
  feed.orgs.push({ externalId: "WBX", name: "World Boxing X", kind: "sanctioning_body" });
  let n = 0;
  const bouts: [string, string, string, string | null, string, Record<string, unknown>?][] = [
    ["2018-01-01", "OLD", "X1", "OLD", "UD", { title: "World Title", titleOrgExternalId: "WBX", titleVacant: true }], // OLD crowned
    ["2018-06-01", "OLD", "X2", "OLD", "KO"],                                                                       // streak 2
    ["2018-09-01", "OLD", "X3", null, "DRAW"],                                                                      // a draw does not break a run
    ["2019-01-01", "OLD", "X1", "OLD", "UD", { title: "World Title", titleOrgExternalId: "WBX" }],                   // defence; last title fight on the belt; streak 4
    ["2020-01-01", "X2", "X3", "X2", "UD"],
    ["2026-05-01", "NEW", "X3", "NEW", "KO", { title: "Interim Title", titleOrgExternalId: "WBX", titleVacant: true }],
  ];
  for (const [date, red, blue, winner, method, over] of bouts) {
    const ev = `EV${++n}`;
    feed.events.push({ externalId: ev, name: `Card ${n}`, date, venue: "Arena", city: "Reno", country: "United States" });
    feed.bouts.push({ externalId: `${ev}-b`, eventExternalId: ev, redExternalId: red, blueExternalId: blue, winnerExternalId: winner, method: method as never, endRound: method === "KO" ? 4 : 12, title: null, position: 1, weightClass: "Lightweight", rounds: 12, ...over } as never);
  }
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  R = await import("../lib/records");
  L = await import("../lib/lineage");
});

const by = (name: string) => w.boxers.find((b) => b.name === `Fighter ${name}`)!;

test("a draw does not break a winning run, a loss would", () => {
  const rows = R.recordList(w, "win-streak", {}, 10);
  assert.equal(rows.find((r) => r.boxer!.id === by("OLD").id)!.value, 3); // win, win, draw, win: the draw leaves the run at 2 and the next win makes 3 (a run broken by the draw would be 2)
  assert.equal(R.recordList(w, "wins", {}, 10)[0].boxer!.id, by("OLD").id);
});

test("a reign still 'running' on a dormant belt stops at the belt's last title fight", () => {
  const belt = L.belts(w).find((b) => b.title === "World Title")!;
  assert.ok(belt.current && belt.stale, "the belt is dormant: its champion is retired and nobody has fought for it in years");
  assert.ok(belt.current!.days > 2000, "the lineage counts a live reign up to today");
  const row = R.recordList(w, "longest-reign", {}, 5).find((r) => r.boxer!.id === by("OLD").id)!;
  assert.equal(row.value, 365); // 2018-01-01 to 2019-01-01, the last title fight: not 8 years
  assert.equal(R.reignDays(belt, belt.current!), 365);
});

test("defences add up across reigns and the interim belt of an active champion keeps counting", () => {
  const def = R.recordList(w, "defenses", {}, 5);
  assert.equal(def[0].boxer!.id, by("OLD").id);
  assert.equal(def[0].value, 1);
  const rows = R.recordList(w, "longest-reign", {}, 5);
  const fresh = rows.find((r) => r.boxer!.id === by("NEW").id)!;
  assert.ok(fresh.value > 0 && fresh.value < 200, "an active champion's reign counts to today (2026-10-03), a few months");
});

test("the legacy score needs ten bouts, so nobody qualifies in a tiny league, and it names its six parts", () => {
  assert.deepEqual(R.recordList(w, "greatest", {}, 5), []);
  assert.deepEqual(R.LEGACY_PARTS, ["peak", "quality", "reign", "defenses", "streak", "honours"]);
});
