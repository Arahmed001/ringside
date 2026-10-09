import test from "node:test";
import assert from "node:assert/strict";
import { previewSelection, rankByRecency, selectionSizes } from "../lib/vendor-selection";
import { coherentCore, reconcileFeed, restrictFeed } from "../lib/vendor-verify";
import { emptyFeed, type FeedData } from "../lib/feed";
import type { ProviderBout, ProviderBoxer, ProviderEvent } from "../lib/providers";

/**
 * Taking the real league in stages: the most recently active fighters first, and the part of a partial load that is right. The ranking decides whom three
 * days of requests are spent on first; the core decides which records may be published when a fighter's career is only partly loaded.
 */
const fight = (id: string, a: string, b: string, event: string, over: Partial<ProviderBout> = {}): ProviderBout => ({
  externalId: id, eventExternalId: event, redExternalId: a, blueExternalId: b, weightClass: "Welterweight", rounds: 10, winnerExternalId: a, method: "UD", endRound: null, title: null, position: 1, ...over,
});
const dates = new Map([["old", "2010-01-01"], ["mid", "2020-06-01"], ["new", "2026-09-01"], ["soon", "2026-11-01"]]);

test("rankByRecency: latest fight first, a coming fight counts, a long career is placed by its newest fight, ties keep the list's order", () => {
  const bouts = [fight("1", "A", "B", "new"), fight("2", "C", "D", "old"), fight("3", "A", "C", "mid"), fight("4", "E", "F", "mid"), fight("5", "G", "B", "soon"), fight("6", "H", "I", "mid")];
  const ranked = rankByRecency(bouts, dates);
  assert.deepEqual(ranked, ["B", "G", "A", "C", "E", "F", "H", "I", "D"], "the coming fight first (B and G tie, B was listed first), then A (September); C (2020) before D (2010): a career is placed by its newest fight; C, E, F, H, I tie on 2020 and keep the list's order");
  assert.equal(new Set(ranked).size, ranked.length, "each fighter once");
});

test("previewSelection: the fights between two chosen fighters, and how many chosen fighters have every fight in the list inside the choice", () => {
  const bouts = [fight("1", "A", "B", "new"), fight("2", "B", "C", "mid"), fight("3", "C", "D", "old"), fight("4", "D", "E", "old")];
  const ranked = ["A", "B", "C", "D", "E"];
  assert.deepEqual(previewSelection(bouts, ranked, 2), { fighters: 2, fights: 1, whole: 1, share: 0.5, closed: 0 }, "A and B: A's only fight is inside; B also fought C, who is out");
  assert.deepEqual(previewSelection(bouts, ranked, 5), { fighters: 5, fights: 4, whole: 5, share: 1, closed: 5 });
  assert.deepEqual(previewSelection(bouts, ranked, 3), { fighters: 3, fights: 2, whole: 2, share: 2 / 3, closed: 0 }, "A and B are whole; C also fought D");
  assert.equal(previewSelection(bouts, ranked, 0).share, 0);
  assert.deepEqual(selectionSizes(30000), [1000, 2500, 5000, 10000, 20000, 30000]);
  assert.deepEqual(selectionSizes(800), [800], "a short list is only itself");
  // two groups that never met: only a group chosen entirely is closed
  const two = [fight("1", "A", "B", "new"), fight("2", "B", "C", "new"), fight("3", "X", "Y", "old"), fight("4", "Z", "Z2", "new", { winnerExternalId: null, method: null })];
  assert.equal(previewSelection(two, ["A", "B", "C", "X", "Y", "Z", "Z2"], 3).closed, 3, "A, B, C are a closed group: nobody outside ever fought them");
  assert.equal(previewSelection(two, ["A", "B", "X", "C", "Y", "Z"], 3).closed, 0, "C is not chosen, so A and B are not closed; X is chosen but Y is not");
  assert.equal(previewSelection(two, ["A", "B", "C", "X", "Y", "Z", "Z2"], 6).closed, 6, "everyone but Z2 is chosen; the fight that counts for nothing (no result) links Z to no one, so Z is closed on its own");
  assert.equal(previewSelection(two, ["A", "B", "C", "X", "Y", "Z", "Z2"], 7).closed, 7);
});

const boxer = (id: string): ProviderBoxer => ({ externalId: id, name: `Boxer ${id}` } as ProviderBoxer);
const feedOf = (ids: string[], bouts: ProviderBout[]): FeedData => ({
  ...emptyFeed(), boxers: ids.map(boxer), bouts,
  events: [...new Set(bouts.map((b) => b.eventExternalId))].map((e) => ({ externalId: e, name: e, date: dates.get(e) ?? "2020-01-01" } as ProviderEvent)),
});
const rec = (w: number, l: number, d = 0) => ({ wins: w, losses: l, draws: d });

test("coherentCore: a record is only right if the opponent's fight is loaded too, so a fighter next to a short record is out as well, and the cut spreads along the whole connected chain", () => {
  // two groups that never met: A beat B; and a chain C beat D, D beat E, E beat F, where F's vendor total says one more fight than we hold
  const bouts = [fight("1", "A", "B", "old"), fight("2", "C", "D", "mid"), fight("3", "D", "E", "mid"), fight("4", "E", "F", "new")];
  const vendor = new Map([["A", rec(1, 0)], ["B", rec(0, 1)], ["C", rec(1, 0)], ["D", rec(1, 1)], ["E", rec(1, 1)], ["F", rec(0, 2)]]);
  const feed = feedOf(["A", "B", "C", "D", "E", "F"], bouts);
  assert.equal(reconcileFeed(feed, vendor).partial, 1, "only F is short");
  const core = coherentCore(feed, vendor);
  assert.equal(core.completeAlone, 5);
  assert.deepEqual([...core.fighters].sort(), ["A", "B"], "E fought F, so E is out; then D (fought E), then C (fought D): the chain goes whole; A and B never met any of them and stay");
  // a short record in the first group instead
  const vendor2 = new Map([...vendor, ["A", rec(2, 0)], ["F", rec(0, 1)]]);
  assert.deepEqual([...coherentCore(feed, vendor2).fighters].sort(), ["C", "D", "E", "F"], "A is short, so B goes with it; the other group is complete and stays");
});

test("coherentCore: a fighter the vendor contradicts, or gave no record for, is out with his opponents; fights that count for nothing hold no one in or out", () => {
  const bouts = [
    fight("1", "A", "B", "old"), fight("2", "C", "D", "old"), fight("3", "E", "F", "old"),
    fight("4", "A", "Z", "mid", { status: "cancelled" }), fight("5", "E", "Y", "soon", { winnerExternalId: null, method: null }), // nothing counts: against fighters who are not loaded
  ];
  const vendor = new Map([["A", rec(1, 0)], ["B", rec(0, 1)], ["C", rec(1, 0)], ["D", rec(1, 0)] /* D's total has no loss, though a fight lists one: a conflict */, ["E", rec(1, 0)] /* F: no record at all */]);
  const core = coherentCore(feedOf(["A", "B", "C", "D", "E", "F"], bouts), vendor);
  assert.deepEqual([...core.fighters].sort(), ["A", "B"], "C is out because D contradicts the vendor; E is out because F has no record to check; A stays despite a cancelled fight against someone not loaded");
});

test("restrictFeed keeps the chosen fighters, the fights between two of them, and the events that still have a fight", () => {
  const bouts = [fight("1", "A", "B", "old"), fight("2", "B", "C", "mid"), fight("3", "A", "C", "new")];
  const cut = restrictFeed(feedOf(["A", "B", "C"], bouts), new Set(["A", "B"]));
  assert.deepEqual(cut.boxers.map((b) => b.externalId), ["A", "B"]);
  assert.deepEqual(cut.bouts.map((b) => b.externalId), ["1"]);
  assert.deepEqual(cut.events.map((e) => e.externalId), ["old"]);
});
