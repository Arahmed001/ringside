import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boutSignature, dropUnchanged, knownSignatures } from "../lib/vendor-unchanged";
import type { ProviderBout, ProviderEvent } from "../lib/providers";

const ev = (id: string, date: string): ProviderEvent => ({ externalId: id, name: id, date, venue: "V", city: "C", country: "X" } as ProviderEvent);
const bout = (id: string, over: Partial<ProviderBout> = {}): ProviderBout => ({ externalId: id, eventExternalId: "e1", redExternalId: "bda-f-a", blueExternalId: "bda-f-b", weightClass: "Welterweight", rounds: 10, winnerExternalId: "bda-f-a", method: "UD", endRound: null, title: null, position: 1, status: undefined, ...over } as ProviderBout);

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, external_id TEXT, date TEXT);
    CREATE TABLE boxers (id INTEGER PRIMARY KEY, external_id TEXT);
    CREATE TABLE bouts (id INTEGER PRIMARY KEY, external_id TEXT, event_id INTEGER, red_id INTEGER, blue_id INTEGER, rounds INTEGER, winner_id INTEGER, method TEXT, end_round INTEGER, status TEXT, title TEXT, round_time TEXT, kd_red INTEGER, kd_blue INTEGER);
    INSERT INTO events VALUES (1, 'e1', '2026-10-01'), (2, 'old', '2026-01-01');
    INSERT INTO boxers VALUES (1, 'bda-f-a'), (2, 'bda-f-b'), (3, 'bda-f-c');
    INSERT INTO bouts (external_id, event_id, red_id, blue_id, rounds, winner_id, method, end_round, status, title, round_time, kd_red, kd_blue) VALUES
      ('b1', 1, 1, 2, 10, 1, 'UD', NULL, NULL, NULL, NULL, NULL, NULL),
      ('b2', 1, 1, 3, 12, NULL, NULL, NULL, 'scheduled', 'WBA', NULL, NULL, NULL),
      ('b-old', 2, 1, 2, 10, 2, 'KO', 3, NULL, NULL, '2:10', 1, 0);`);
  return d;
}

test("what the database holds is read in the same form as a listed fight, so an unchanged fight matches (and only fights from the date on are read)", () => {
  const known = knownSignatures(db(), "2026-09-01");
  assert.equal(known.size, 2, "the January fight is outside the window");
  assert.equal(known.get("b1"), boutSignature(bout("b1"), "2026-10-01"));
  assert.equal(known.get("b2"), boutSignature(bout("b2", { blueExternalId: "bda-f-c", rounds: 12, winnerExternalId: null, method: null, status: "scheduled", title: "WBA" }), "2026-10-01"));
});

test("new and changed fights are kept, with their fighters; unchanged ones are left out", () => {
  const known = knownSignatures(db(), "2026-09-01");
  const events = new Map([["e1", ev("e1", "2026-10-01")], ["e2", ev("e2", "2026-10-09")]]);
  const unchanged = bout("b1");
  const resultArrived = bout("b2", { blueExternalId: "bda-f-c", rounds: 12, winnerExternalId: "bda-f-c", method: "KO", endRound: 7, status: undefined, title: "WBA" });
  const brandNew = bout("b3", { eventExternalId: "e2", redExternalId: "bda-f-x", blueExternalId: "bda-f-y", winnerExternalId: null, method: null });
  const r = dropUnchanged([unchanged, resultArrived, brandNew], events, known);
  assert.deepEqual(r.kept.map((b) => b.externalId), ["b2", "b3"]);
  assert.equal(r.skipped, 1);
  assert.deepEqual([...r.fighters].sort(), ["bda-f-c", "bda-f-a", "bda-f-x", "bda-f-y"].sort());
});

test("every field that changes what a page shows makes a fight count as changed: a new date, a cancelled card, another winner, method, round, rounds, belt, fighters", () => {
  const known = knownSignatures(db(), "2026-09-01"), events = new Map([["e1", ev("e1", "2026-10-01")]]);
  const kept = (over: Partial<ProviderBout>, date = "2026-10-01") => dropUnchanged([bout("b1", over)], new Map([["e1", ev("e1", date)]]), known).kept.length;
  assert.equal(kept({}), 0, "the control: the same fight is unchanged");
  assert.equal(kept({}, "2026-10-08"), 1, "the card moved to another date");
  for (const over of [{ status: "cancelled" }, { winnerExternalId: "bda-f-b" }, { method: "KO" as never }, { endRound: 4 }, { rounds: 12 }, { title: "WBC" }, { blueExternalId: "bda-f-c" }, { winnerExternalId: null, method: null }, { kdRed: 1 }, { roundTime: "1:00" }] as Partial<ProviderBout>[]) assert.equal(kept(over), 1, JSON.stringify(over));
  assert.equal(dropUnchanged([bout("never-seen")], events, known).kept.length, 1, "a fight the database does not hold is new");
  assert.equal(dropUnchanged([bout("b1")], events, new Map()).kept.length, 1, "with nothing known, nothing is skipped");
});
