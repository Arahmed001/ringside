import test, { after } from "node:test";
import assert from "node:assert/strict";
import { miniFeed, providerOf, tempDb } from "./helpers";
import { classifyRecord, describeReconciliation, reconcileDb, reconcileFeed, recordGate } from "../lib/vendor-verify";
import type { FeedData } from "../lib/feed";

/**
 * Nothing here can prove the vendor's facts true. It can prove the feed agrees with itself: a fighter's loaded fights either add up to
 * the career record the vendor states, or they do not, and a record that does not add up is one Ringside would publish wrongly.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("vendor-verify");
after(cleanup);
const rec = (w: number, l: number, d: number) => ({ wins: w, losses: l, draws: d });

test("a record is complete when the fights add up exactly, partial when some are missing, and a conflict when they add up to MORE than the vendor says", () => {
  assert.equal(classifyRecord(rec(19, 0, 1), rec(19, 0, 1)), "complete");
  assert.equal(classifyRecord(rec(0, 0, 0), rec(0, 0, 0)), "complete", "a debutant with no fights loaded is exact");
  assert.equal(classifyRecord(rec(1, 0, 0), rec(19, 0, 1)), "partial", "the free window gave one of twenty fights");
  assert.equal(classifyRecord(rec(18, 0, 1), rec(19, 0, 1)), "partial");
  assert.equal(classifyRecord(rec(20, 0, 1), rec(19, 0, 1)), "conflict", "more wins than the career total");
  assert.equal(classifyRecord(rec(5, 3, 0), rec(5, 2, 0)), "conflict", "one more loss");
  assert.equal(classifyRecord(rec(5, 2, 1), rec(5, 2, 0)), "conflict", "a draw the vendor does not have");
  assert.equal(classifyRecord(rec(6, 0, 0), rec(5, 5, 0)), "conflict", "one count over is a conflict even when the others are short");
});

const bout = (id: string, red: string, blue: string, over: Record<string, unknown> = {}) => ({
  externalId: id, eventExternalId: "E", redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 10, winnerExternalId: red as string | null,
  method: "UD" as string | null, endRound: 10, title: null, position: 0, ...over,
}) as unknown as FeedData["bouts"][number];
const boxer = (id: string) => ({ externalId: id, name: `Fighter ${id}` }) as unknown as FeedData["boxers"][number];

test("reconciling a feed: wins, losses and draws are counted from the fights; cancelled and unresolved fights count for nothing; fighters with no vendor record are set aside", () => {
  const feed = { ...miniFeed(), boxers: ["A", "B", "C", "D", "E"].map(boxer), bouts: [
    bout("1", "A", "B"),                                            // A beats B
    bout("2", "C", "D", { winnerExternalId: null, method: "DRAW" }), // C and D draw
    bout("3", "A", "B", { status: "cancelled" }),                   // never happened
    bout("4", "A", "B", { winnerExternalId: null, method: null }),  // no result yet
  ] } as FeedData;
  const vendor = new Map([["A", rec(1, 0, 0)], ["B", rec(0, 1, 0)], ["C", rec(0, 0, 2)], ["D", rec(0, 0, 0)]]);
  const r = reconcileFeed(feed, vendor);
  assert.deepEqual([r.checked, r.complete, r.partial, r.conflict, r.noVendorRecord], [4, 2, 1, 1, 1]);
  assert.equal(r.share, 0.5);
  assert.deepEqual(r.partials, [{ externalId: "C", name: "Fighter C", loaded: "0-0-1", vendor: "0-0-2" }]);
  assert.deepEqual(r.conflicts, [{ externalId: "D", name: "Fighter D", loaded: "0-0-1", vendor: "0-0-0" }]);
  const text = describeReconciliation(r).join("\n");
  assert.match(text, /2 of 4 fighters \(50\.0%\)/); assert.match(text, /1 partial.*shorter record/); assert.match(text, /1 CONFLICT.*contradicts itself/); assert.match(text, /1 fighter\(s\) came with no career record/);
  assert.equal(reconcileFeed({ ...feed, bouts: [] } as FeedData, new Map()).share, 0, "nothing to check is a share of 0, not 100%");
});

test("reconciling the database (the daily update): the same check over what is stored, optionally for some fighters only", async () => {
  const db = await (await import("../lib/db")).getDb();
  const { ingest } = await import("../lib/ingest");
  await ingest(db, providerOf(miniFeed())); // A (red) beats B by UD
  assert.deepEqual(reconcileDb(db, new Map([["A", rec(1, 0, 0)], ["B", rec(0, 1, 0)]])).complete, 2);
  assert.equal(reconcileDb(db, new Map([["A", rec(2, 0, 0)], ["B", rec(0, 1, 0)]])).partial, 1, "the vendor says more than we hold");
  const conflict = reconcileDb(db, new Map([["A", rec(0, 0, 0)], ["B", rec(0, 1, 0)]]));
  assert.equal(conflict.conflict, 1); assert.equal(conflict.conflicts[0].name, "Fighter A");
  assert.deepEqual(reconcileDb(db, new Map([["A", rec(2, 0, 0)], ["B", rec(0, 1, 0)]]), ["B"]).checked, 1, "only the fighters asked about");
});

const bad = (checked: number, complete: number, partial: number, conflict: number) => ({
  checked, complete, partial, conflict, noVendorRecord: 0, share: checked ? complete / checked : 0,
  conflicts: Array.from({ length: conflict }, (_, i) => ({ externalId: `c${i}`, name: `Conflicted ${i}`, loaded: "5-0-0", vendor: "4-0-0" })),
  partials: Array.from({ length: partial }, (_, i) => ({ externalId: `p${i}`, name: `Partial ${i}`, loaded: "1-0-0", vendor: "20-0-0" })),
});
const open = { minComplete: 0.9, allowPartial: false, allowConflicts: false };

test("the gate: a conflict always needs a deliberate override; too few complete records refuse a load; the bar and the overrides are explicit", () => {
  assert.deepEqual(recordGate(bad(100, 100, 0, 0), open), { ok: true, reasons: [] });
  assert.equal(recordGate(bad(100, 90, 10, 0), open).ok, true, "exactly at the bar passes");
  const low = recordGate(bad(100, 89, 11, 0), open);
  assert.equal(low.ok, false); assert.match(low.reasons[0], /only 89\.0% of fighters \(89 of 100\).*90% is required.*SHORTER record.*Partial 0: loaded 1-0-0, vendor 20-0-0/);
  assert.equal(recordGate(bad(100, 89, 11, 0), { ...open, minComplete: 0.85 }).ok, true);
  assert.equal(recordGate(bad(100, 0, 100, 0), { ...open, allowPartial: true }).ok, true, "a window shorter than the careers can be loaded on purpose");
  const clash = recordGate(bad(100, 99, 0, 1), open);
  assert.equal(clash.ok, false); assert.match(clash.reasons[0], /MORE wins, losses or draws.*Conflicted 0: loaded 5-0-0, vendor 4-0-0/);
  assert.equal(recordGate(bad(100, 99, 0, 1), { ...open, allowConflicts: true }).ok, true);
  assert.equal(recordGate(bad(100, 0, 100, 5), { ...open, allowPartial: true }).ok, false, "allowing partial records does not allow conflicts");
  const none = recordGate(bad(0, 0, 0, 0), open);
  assert.equal(none.ok, false); assert.match(none.reasons[0], /no career records/);
  assert.equal(recordGate(bad(0, 0, 0, 0), { ...open, allowPartial: true }).ok, true);
  assert.equal(recordGate(bad(100, 50, 40, 10), open).reasons.length, 2, "both problems are reported");
});
