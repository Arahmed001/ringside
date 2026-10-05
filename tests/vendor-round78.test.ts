import test, { after } from "node:test";
import assert from "node:assert/strict";
import { miniFeed, tempDb } from "./helpers";

/**
 * Round 78, from the user's first look at a real cache (261 of 8,414 records add up, 223 conflicts): the same fight listed twice, a vendor total that trails the
 * last days' results, fighters whose records still contradict the feed, and fights skipped for reasons the count did not say.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("round78");
after(cleanup);

import * as B from "../lib/providers/boxing-data-api";
import { dropConflicted, reconcileFeed } from "../lib/vendor-verify";
import type { FeedData } from "../lib/feed";
import type { ProviderBout } from "../lib/providers";

const KEY = "sk-test-key-0123456789abcdef0123456789";
const notes = () => ({ ...B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: (async () => new Response("{}")) as typeof fetch }).notes() });
const bout = (id: string, red: string, blue: string, ev: string, over: Partial<ProviderBout> = {}): ProviderBout => ({
  externalId: id, eventExternalId: ev, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12, winnerExternalId: red, method: "UD", endRound: 12, title: null, position: 0, ...over,
});
const dates = new Map([["e1", "2018-10-13"], ["e2", "2018-10-14"], ["e3", "2018-10-15"], ["e9", "2019-03-01"]]);

test("the same fight listed twice is one fight: the copies within a day of each other, agreeing on the winner, merge to the one with a result", () => {
  const n = notes();
  const out = B.mergeDuplicateFights([
    bout("old", "H", "K", "e1", { method: "KO", scores: undefined }),
    bout("new", "K", "H", "e2", { winnerExternalId: "H", method: "TKO" }),   // the other record: corners swapped, a day later, TKO for KO
    bout("other", "H", "Z", "e1"),                                            // a different opponent: untouched
  ], dates, n);
  assert.equal(out.length, 2); assert.ok(out.some((b) => b.externalId === "other"));
  const kept = out.filter((b) => b.externalId !== "other");
  assert.equal(kept.length, 1, "one copy of the fight with K"); assert.equal(kept[0].winnerExternalId, "H");
  assert.equal(n.duplicateFightsMerged, 1); assert.equal(n.duplicateFightsDisagree, 0);
  // a copy with no result and a copy with one: the one with the result is kept, even though the other sorts first
  const m = B.mergeDuplicateFights([bout("m1", "M", "N", "e1", { winnerExternalId: null, method: null, endRound: null }), bout("m2", "M", "N", "e2")], dates, notes());
  assert.deepEqual(m.map((b) => [b.externalId, b.winnerExternalId]), [["m2", "M"]]);
});

test("copies that disagree on the winner are not believed: one stays, as 'no result yet'", () => {
  const n = notes();
  const out = B.mergeDuplicateFights([
    bout("a", "H", "D", "e1", { winnerExternalId: "H" }),
    bout("b", "H", "D", "e1", { winnerExternalId: "D" }),
    bout("c", "D", "H", "e1", { winnerExternalId: null, method: "DRAW" }),
  ], dates, n);
  assert.equal(out.length, 1);
  assert.equal(out[0].winnerExternalId, null); assert.equal(out[0].method, null); assert.equal(out[0].endRound, null);
  assert.equal(n.duplicateFightsMerged, 2); assert.equal(n.duplicateFightsDisagree, 1);
});

test("real rematches are not merged: months apart, two days apart, a cancelled copy, a copy with no date", () => {
  const n = notes();
  const all = [
    bout("r1", "H", "D", "e1"), bout("r2", "H", "D", "e9"),             // five months apart
    bout("t1", "A", "B", "e1"), bout("t2", "A", "B", "e3"),             // 13th and 15th: two days
    bout("c1", "C", "E", "e1"), bout("c2", "C", "E", "e1", { status: "cancelled" }),
    bout("u1", "F", "G", "e1"), bout("u2", "F", "G", "nodate"),
  ];
  assert.equal(B.mergeDuplicateFights(all, dates, n).length, all.length);
  assert.equal(n.duplicateFightsMerged, 0);
  // exactly a day apart is one fight
  assert.equal(B.mergeDuplicateFights([bout("x1", "A", "B", "e1"), bout("x2", "A", "B", "e2")], dates, n).length, 1);
});

test("skipped fights are counted under their reason, and in the total", () => {
  const n = notes();
  const f = (over: Record<string, unknown>) => ({ id: "x", date: "2024-12-21T21:00:00+00:00", fighters: { fighter_1: { fighter_id: "A" }, fighter_2: { fighter_id: "B" } }, ...over }) as unknown as B.ApiFight;
  assert.equal(B.mapFight(f({ id: "" }), n), null);
  assert.equal(B.mapFight(f({ fighters: { fighter_1: { fighter_id: "A" }, fighter_2: { fighter_id: null } } }), n), null);
  assert.equal(B.mapFight(f({ date: "soon" }), n), null);
  assert.equal(B.mapFight(f({ fighters: { fighter_1: { fighter_id: "A" }, fighter_2: { fighter_id: "A" } } }), n), null);
  assert.deepEqual([n.fightsSkippedNoId, n.fightsSkippedNoFighter, n.fightsSkippedNoDate, n.fightsSkippedSameFighter, n.fightsSkipped], [1, 1, 1, 1, 4]);
});

const rec = (w: number, l: number, d: number) => ({ wins: w, losses: l, draws: d });
const withBouts = (events: [string, string][], bouts: ProviderBout[]): FeedData => ({ ...miniFeed(), boxers: ["A", "B", "C"].map((id) => ({ externalId: id, name: `Fighter ${id}` }) as FeedData["boxers"][number]), events: events.map(([externalId, date]) => ({ externalId, date }) as FeedData["events"][number]), bouts: bouts as FeedData["bouts"] });

test("in a load, a surplus that is only the last days' fights is the vendor's total trailing (lagging), and an older one is still a conflict", () => {
  const feed = withBouts([["new", "2026-10-01"], ["old", "2026-08-01"]], [bout("1", "A", "B", "new"), bout("2", "C", "B", "old")]);
  const vendor = new Map([["A", rec(0, 0, 0)], ["B", rec(0, 1, 0)], ["C", rec(0, 0, 0)]]);
  // A: a win 4 days old against a vendor total of none; C: the same win 2 months old; B: two losses against one, one of them 4 days old
  const strict = reconcileFeed(feed, vendor);
  assert.deepEqual([strict.conflict, strict.lagging], [3, 0], "strictly all three exceed the vendor's totals");
  const r = reconcileFeed(feed, vendor, { today: "2026-10-05", days: 7 });
  assert.deepEqual(r.conflicts.map((m) => m.externalId), ["C"], "only C's surplus has nothing to do with the last days");
  assert.deepEqual(r.laggards.map((m) => m.externalId).sort(), ["A", "B"], "A's and B's surpluses vanish without the 4-day-old fight");
  assert.equal(r.lagging, 2);
});

test("--drop-conflicts: the conflicted fighters leave with their fights, the others stay, and nobody becomes a conflict", () => {
  const feed = withBouts([["e", "2020-01-01"]], [bout("1", "A", "B", "e"), bout("2", "B", "C", "e", { winnerExternalId: "C" })]);
  const vendor = new Map([["A", rec(1, 0, 0)], ["B", rec(0, 0, 0)], ["C", rec(1, 0, 0)]]); // B: loaded 0-2-0 against 0-0-0
  const before = reconcileFeed(feed, vendor);
  assert.deepEqual(before.conflicts.map((m) => m.externalId), ["B"]);
  const out = dropConflicted(feed, before);
  assert.deepEqual(out.feed.boxers.map((b) => b.externalId), ["A", "C"]);
  assert.equal(out.feed.bouts.length, 0); assert.equal(out.fightsDropped, 2);
  assert.deepEqual(out.dropped.map((m) => [m.name, m.loaded, m.vendor]), [["Fighter B", "0-2-0", "0-0-0"]]);
  const after = reconcileFeed(out.feed, vendor);
  assert.equal(after.conflict, 0); assert.equal(after.partial, 2, "A and C each lost the fight with B: shorter, so partial, not a conflict");
  const clean = dropConflicted(out.feed, after);
  assert.equal(clean.feed, out.feed, "nothing to drop: the feed is returned as it was"); assert.deepEqual(clean.dropped, []);
});

import { lagDays } from "../lib/vendor-backfill";
test("how long a vendor total may trail its results: a week for the daily update, two for a load, either set by the environment, nonsense ignored (round 80)", () => {
  assert.equal(lagDays("update", {}), 7); assert.equal(lagDays("load", {}), 14);
  assert.equal(lagDays("update", { VENDOR_LAG_DAYS: "10" }), 10); assert.equal(lagDays("load", { VENDOR_LAG_DAYS: "10" }), 10, "the older variable still sets both");
  assert.equal(lagDays("load", { VENDOR_LAG_DAYS: "10", VENDOR_LOAD_LAG_DAYS: "3" }), 3); assert.equal(lagDays("update", { VENDOR_LAG_DAYS: "10", VENDOR_LOAD_LAG_DAYS: "3" }), 10);
  for (const bad of ["", "0", "-2", "x", "3.5"]) { assert.equal(lagDays("update", { VENDOR_LAG_DAYS: bad }), 7, bad); assert.equal(lagDays("load", { VENDOR_LOAD_LAG_DAYS: bad }), 14, bad); }
});

test("the same fight under two PROFILES of the same opponent, a day apart, is one fight (round 82: Mayweather against two 'Canelo Alvarez' ids)", () => {
  const n = notes();
  const names = new Map([["M", "Floyd Mayweather"], ["C1", "Canelo Alvarez"], ["C2", "Canelo Álvarez "], ["X", "Someone Else"]]);
  const out = B.mergeDuplicateFights([
    bout("old", "M", "C1", "e1", { method: "MD" }),
    bout("new", "M", "C2", "e2", { method: "MD" }),            // the other generation: the other profile, a day later, the accent and a trailing space differ
    bout("other", "M", "X", "e1"),                             // a different opponent
  ], dates, n, names);
  assert.equal(out.length, 2); assert.ok(out.some((b) => b.externalId === "other"));
  assert.equal(n.duplicateFightsMerged, 1); assert.equal(n.duplicateFightsAcrossProfiles, 1, "counted as across profiles");
  // without the names the two profiles are two opponents: nothing merges
  const n2 = notes();
  assert.equal(B.mergeDuplicateFights([bout("old", "M", "C1", "e1"), bout("new", "M", "C2", "e2")], dates, n2).length, 2);
  // the same two ids merge as before, and are not counted as across profiles
  const n3 = notes();
  assert.equal(B.mergeDuplicateFights([bout("a", "M", "C1", "e1"), bout("b", "C1", "M", "e2", { winnerExternalId: "M" })], dates, n3, names).length, 1);
  assert.equal(n3.duplicateFightsAcrossProfiles, 0);
});
