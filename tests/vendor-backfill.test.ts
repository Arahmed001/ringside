import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";

const cleanup = tempDb("vendor-backfill"); // today is 2026-10-03; the demo league seeds the database
after(cleanup);
import { describePlan, foreignFighters, updateSince } from "../lib/vendor-backfill";

test("a database that holds the demo league is foreign to the feed: counted, with an example, so the backfill can refuse to mix them", async () => {
  const db = await (await import("../lib/db")).getDb();
  const f = foreignFighters(db);
  assert.ok(f.total > 100 && f.fromFeed === 0 && f.foreign === f.total);
  assert.ok(typeof f.example === "string" && f.example.length > 0);
  db.prepare("INSERT INTO boxers (external_id, slug, name, country, birth_year, stance, height_cm, reach_cm, weight_class, turned_pro, active) VALUES ('bda-f-x1', 'real-one', 'Real One', 'Denmark', 1999, 'Orthodox', 180, 180, 'Welterweight', 2019, 1)").run();
  const g = foreignFighters(db);
  assert.deepEqual([g.fromFeed, g.foreign], [1, f.foreign], "the feed's fighters are told apart by their id");
  db.prepare("DELETE FROM boxers WHERE external_id = 'bda-f-x1'").run();
});

test("a daily update starts at the latest card that has happened, less an overlap; cancelled and coming cards do not count; nothing yet means nothing to update", async () => {
  const db = await (await import("../lib/db")).getDb();
  const latest = (db.prepare("SELECT MAX(date) d FROM events WHERE date <= '2026-10-03' AND COALESCE(status, '') != 'cancelled'").get() as { d: string }).d;
  const minus = (d: string, n: number) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);
  assert.equal(updateSince(db, "2026-10-03"), minus(latest, 14));
  assert.equal(updateSince(db, "2026-10-03", 3), minus(latest, 3));
  const add = db.prepare("INSERT INTO events (external_id, name, date, venue, city, country, status) VALUES (?, ?, ?, 'v', 'c', 'k', ?)");
  add.run("t-cancelled", "Cancelled", "2026-10-02", "cancelled"); add.run("t-coming", "Coming", "2026-12-01", null);
  assert.equal(updateSince(db, "2026-10-03"), minus(latest, 14), "a cancelled card and a coming one change nothing");
  add.run("t-fresh", "Fresh", "2026-10-01", "completed");
  assert.equal(updateSince(db, "2026-10-03"), "2026-09-17", "a newer completed card moves it");
  const empty = new DatabaseSync(":memory:");
  empty.exec("CREATE TABLE events (date TEXT, status TEXT)");
  assert.equal(updateSince(empty, "2026-10-03"), null, "nothing has happened yet");
  empty.exec("INSERT INTO events VALUES ('2026-12-01', NULL)");
  assert.equal(updateSince(empty, "2026-10-03"), null, "only a coming card is still nothing");
  for (const id of ["t-cancelled", "t-coming", "t-fresh"]) db.prepare("DELETE FROM events WHERE external_id = ?").run(id);
});

test("the plan says how big the job is and roughly how long, from the numbers the list pages gave", () => {
  const lines = describePlan({ fights: 1000, events: 200, fighters: 3000, fightersCached: 500, fighterRequests: 2500, requestsMade: 10 }, { gapMs: 300 });
  assert.match(lines[0], /fights 1000, events 200, fighters 3000/);
  assert.match(lines.join("\n"), /already in the cache \(free\): 500/);
  assert.match(lines.join("\n"), /still to fetch: 2500 request\(s\), about 23 minute\(s\) at 300 ms/);
  assert.match(describePlan({ fights: 0, events: 0, fighters: 0, fightersCached: 0, fighterRequests: 0, requestsMade: 1 }, { gapMs: 300 }).join("\n"), /about 0 minute/);
});
