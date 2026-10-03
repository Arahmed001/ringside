import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("world");
after(cleanup);
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let ev: typeof import("../lib/events");
let rk: typeof import("../lib/rankings");
let m: typeof import("../lib/methods");

before(async () => {
  w = await (await import("../lib/world")).getWorld();
  ev = await import("../lib/events"); rk = await import("../lib/rankings"); m = await import("../lib/methods");
});

test("the pinned clock drives 'today'", () => {
  assert.equal(w.today, "2026-10-03");
});

test("every fighter's record equals the results that count, and the league's wins equal its losses", () => {
  let wins = 0, losses = 0;
  for (const b of w.boxers) {
    const counted = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && m.countsInRecord(x.method));
    assert.equal(b.wins + b.losses + b.draws, counted.length, `${b.name}'s record vs his bouts`);
    assert.equal(b.bouts, counted.length);
    wins += b.wins; losses += b.losses;
  }
  assert.equal(wins, losses, "every decisive result is one win and one loss");
});

test("no-contests are excluded from records; corner retirements count as knockouts; disqualifications do not", () => {
  const nc = w.bouts.find((b) => b.method === "NC")!;
  const f = w.byId.get(nc.redId)!;
  assert.equal(f.bouts, (w.boutsByBoxer.get(f.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC").length);
  for (const b of w.boxers) {
    const wonByStoppage = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => x.winnerId === b.id && m.isStoppage(x.method)).length;
    assert.equal(b.kos, wonByStoppage, `${b.name} knockouts`);
  }
  const rtd = w.bouts.find((b) => b.method === "RTD")!;
  assert.ok(m.isStoppage(rtd.method) && w.byId.get(rtd.winnerId!)!.kos >= 1);
});

test("cancelled cards and bouts never appear as upcoming", () => {
  const cancelled = w.events.filter((e) => e.status === "cancelled");
  assert.ok(cancelled.length > 0);
  const upcoming = new Set(ev.upcomingEvents(w).map((e) => e.id));
  for (const e of cancelled) assert.ok(!upcoming.has(e.id), `${e.name} is cancelled`);
  assert.ok(w.events.some((e) => e.status === "postponed" && e.upcoming), "a postponed card stays on the calendar");
  for (const b of w.bouts) if (b.status === "cancelled") assert.ok(!b.upcoming && b.method === null);
  const recent = ev.recentEvents(w, 10000);
  assert.ok(recent.every((e) => e.status !== "cancelled"));
});

test("every upcoming card has a headline bout, and nobody is booked twice", () => {
  const seen = new Map<number, number>();
  for (const e of ev.upcomingEvents(w)) {
    const view = ev.eventWithMain(w, e);
    assert.ok(view && view.main.status !== "cancelled");
    for (const b of ev.liveBouts(w, e.id)) for (const id of [b.redId, b.blueId]) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  assert.equal([...seen.values()].filter((n) => n > 1).length, 0);
});

test("rankings are separate for men and women, active, and have a winning record", () => {
  const men = rk.rankDivision(w, "Welterweight", 15, "male"), women = rk.rankDivision(w, "Welterweight", 15, "female");
  assert.ok(men.length > 0 && women.length > 0, "both rosters rank in welterweight");
  assert.ok(men.every((r) => r.boxer.sex === "male") && women.every((r) => r.boxer.sex === "female"));
  for (const r of [...men, ...women]) assert.ok(r.boxer.active && r.boxer.winRate >= 0.5 && r.boxer.bouts >= 5, r.boxer.name);
  assert.deepEqual(men.map((r) => r.rank), men.map((_, i) => i + 1));
  for (let i = 1; i < men.length; i++) assert.ok(men[i - 1].boxer.rating >= men[i].boxer.rating);
  assert.ok(rk.pound4pound(w, 10, "female").every((b) => b.sex === "female"));
  const top = men[0].boxer;
  assert.equal(rk.rankOf(w, top), 1);
});

test("no women's roster outside the divisions the demo seeds", () => {
  const women = w.boxers.filter((b) => b.sex === "female");
  assert.ok(women.length > 100);
  assert.ok(!women.some((b) => b.weightClass === "Heavyweight" || b.weightClass === "Minimumweight"));
});

test("weigh-ins, officials and corners are indexed by bout", () => {
  const done = w.bouts.filter((b) => !b.upcoming && b.method);
  const withWeighIns = done.filter((b) => (w.weighInsByBout.get(b.id)?.length ?? 0) === 2).length;
  assert.ok(withWeighIns / done.length > 0.95, "nearly every completed bout has both weigh-ins");
  assert.ok(done.every((b) => (w.officialsByBout.get(b.id) ?? []).some((o) => o.role === "referee")));
  assert.ok([...w.roles.values()].some((r) => r.has("trainer")) && [...w.roles.values()].some((r) => r.has("judge")));
});
