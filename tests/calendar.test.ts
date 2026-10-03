import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * A hand-built calendar covering every status combination the demo does not: a cancelled bout on a card that is
 * still happening, a postponed card, a wholly cancelled future card and a wholly cancelled past card.
 * It is loaded through the JSON file provider, which also exercises BOXING_PROVIDER=file.
 */
const cleanupDb = tempDb("calendar");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-cal-"));
after(() => { cleanupDb(); fs.rmSync(dir, { recursive: true, force: true }); });

const bout = (id: string, ev: string, red: string, blue: string, position: number, status?: "cancelled") => ({
  externalId: id, eventExternalId: ev, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 10,
  winnerExternalId: null, method: null, endRound: null, title: null, position, status,
});
const ev = (id: string, date: string, status?: "cancelled" | "postponed") => ({ externalId: id, name: `Card ${id}`, date, venue: "Arena", city: "Reno", country: "United States", status });

let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let events: typeof import("../lib/events");

before(async () => {
  const feed = miniFeed();
  feed.boxers.push(...["C", "D", "E", "F", "G", "H"].map((id) => makeBoxer(id)));
  feed.events.push(ev("E2", "2026-12-01"), ev("E3", "2026-12-08", "cancelled"), ev("E4", "2026-12-15", "postponed"), ev("E5", "2026-03-01", "cancelled"),
    ev("E6", "2026-12-22"), ev("E7", "2026-02-01")); // E6 and E7 are not cancelled themselves, but every bout on them is
  feed.bouts.push(
    bout("E2-1", "E2", "A", "B", 5, "cancelled"), // higher billing than E2-2, but cancelled
    bout("E2-2", "E2", "C", "D", 1),
    bout("E3-1", "E3", "E", "F", 0, "cancelled"),
    bout("E4-1", "E4", "G", "H", 0),
    bout("E5-1", "E5", "E", "F", 0, "cancelled"),
    bout("E6-1", "E6", "E", "F", 0, "cancelled"),
    bout("E7-1", "E7", "G", "H", 0, "cancelled"),
  );
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  events = await import("../lib/events");
});

test("the file provider seeded the database instead of the demo league", () => {
  assert.equal(w.boxers.length, 8);
});

test("a cancelled bout on a live card is not upcoming and does not headline", () => {
  const cancelled = w.bouts.find((b) => b.id && b.redName === "Fighter A" && b.status === "cancelled")!;
  assert.ok(cancelled && !cancelled.upcoming && cancelled.method === null);
  const live = w.bouts.find((b) => b.redName === "Fighter C")!;
  assert.ok(live.upcoming && live.status === "scheduled");
  const e2 = w.events.find((e) => e.name === "Card E2")!;
  const view = events.eventWithMain(w, e2)!;
  assert.equal(view.main.id, live.id, "the first non-cancelled bout is the headline, whatever its billing");
  assert.equal(view.bouts.length, 2, "the cancelled bout is still listed on the card");
  assert.deepEqual((w.boutsByBoxer.get(w.boxers.find((b) => b.name === "Fighter A")!.id) ?? []).filter((b) => b.upcoming), [], "no upcoming fight for a fighter whose bout was cancelled");
});

test("calendar membership: live and postponed cards in, cancelled cards out", () => {
  const upcoming = events.upcomingEvents(w).map((e) => e.name);
  assert.deepEqual(upcoming, ["Card E2", "Card E4"]);
  const e4 = w.events.find((e) => e.name === "Card E4")!;
  assert.ok(e4.status === "postponed" && e4.upcoming, "a postponed card stays upcoming under its new date");
  const e3 = w.events.find((e) => e.name === "Card E3")!;
  assert.ok(e3.status === "cancelled" && !e3.upcoming);
  const recent = events.recentEvents(w, 100).map((e) => e.name);
  assert.deepEqual(recent, ["Test Night"], "cancelled cards never appear as results");
  const names = (list: { name: string }[]) => list.map((e) => e.name);
  assert.ok(!names(events.upcomingEvents(w)).includes("Card E6"), "a future card whose every bout is cancelled is not on the calendar");
  assert.ok(!names(events.recentEvents(w, 100)).includes("Card E7"), "a past card whose every bout is cancelled is not a result");
});

test("cancellations do not touch anyone's record", () => {
  for (const name of ["Fighter E", "Fighter F"]) {
    const f = w.boxers.find((b) => b.name === name)!;
    assert.equal(f.bouts, 0, `${name} has fought nobody`);
  }
  const a = w.boxers.find((b) => b.name === "Fighter A")!;
  assert.equal(a.wins, 1);
});
