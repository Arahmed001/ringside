import test, { after } from "node:test";
import assert from "node:assert/strict";
import { miniFeed, providerOf, tempDb } from "./helpers";
import { classifyRecord, describeConflictReport, describeReconciliation, explainConflicts, reconcileDb, reconcileFeed, recordGate } from "../lib/vendor-verify";
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
  assert.match(text, /2 of 4 fighters \(50\.0%\)/); assert.match(text, /1 partial.*fewer fights are held/); assert.match(text, /1 CONFLICT.*contradicts itself/); assert.match(text, /1 fighter\(s\) came with no career record/);
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

test("the daily update's audit: a surplus that only the last few days' fights cause is 'lagging' (the vendor's totals trail its results), anything older is still a conflict, and without the allowance the check is strict", async () => {
  const db = await (await import("../lib/db")).getDb();
  const { ingest } = await import("../lib/ingest");
  const f = miniFeed(); // 2025-01-10: A beats B
  const older = { ...f, events: [...f.events, { ...f.events[0], externalId: "E0", name: "Older Night", date: "2024-06-01" }], bouts: [...f.bouts, { ...f.bouts[0], externalId: "E0-1", eventExternalId: "E0", position: 0 }] } as FeedData;
  await ingest(db, providerOf(older)); // A has beaten B twice: 2024-06-01 and 2025-01-10
  const lag = { today: "2025-01-12", days: 7 };
  // the vendor has counted the old win but not yet the new one: 1-0-0 against our 2-0-0 and 0-2-0
  const trailing = new Map([["A", rec(1, 0, 0)], ["B", rec(0, 1, 0)]]);
  const strict = reconcileDb(db, trailing);
  assert.deepEqual([strict.conflict, strict.lagging], [2, 0], "without the allowance it is a conflict, as for a load");
  const r = reconcileDb(db, trailing, undefined, lag);
  assert.deepEqual([r.conflict, r.lagging, r.complete], [0, 2, 0]);
  assert.deepEqual(r.laggards.map((m) => `${m.name} ${m.loaded} vs ${m.vendor}`), ["Fighter A 2-0-0 vs 1-0-0", "Fighter B 0-2-0 vs 0-1-0"]);
  assert.match(describeReconciliation(r).join("\n"), /2 career total\(s\) probably lagging.*Fighter A loaded 2-0-0 vs vendor 1-0-0.*next day's update/);
  assert.ok(!/CONFLICT/.test(describeReconciliation(r).join("\n")));
  // one recent fight cannot explain a surplus of two: the vendor says A has no wins at all
  const wrong = reconcileDb(db, new Map([["A", rec(0, 0, 0)], ["B", rec(0, 1, 0)]]), undefined, lag);
  assert.deepEqual([wrong.conflict, wrong.lagging], [1, 1], "A is a conflict (two wins loaded, one of them recent, vendor has none); B is only lagging");
  assert.equal(wrong.conflicts[0].name, "Fighter A");
  // the same surplus with the recent window moved past the fight is a conflict again: the fight is not recent any more
  const late = reconcileDb(db, trailing, undefined, { today: "2025-03-01", days: 7 });
  assert.deepEqual([late.conflict, late.lagging], [2, 0]);
  // a record that adds up, and a short one, are not touched by the allowance
  assert.equal(reconcileDb(db, new Map([["A", rec(2, 0, 0)], ["B", rec(0, 2, 0)]]), undefined, lag).complete, 2);
  assert.equal(reconcileDb(db, new Map([["A", rec(3, 0, 0)], ["B", rec(0, 2, 0)]]), undefined, lag).partial, 1);
  // a load is strict: reconcileFeed has no allowance at all
  assert.equal(reconcileFeed(older, new Map([["A", rec(1, 0, 0)], ["B", rec(0, 1, 0)]])).conflict, 2);
});

const bad = (checked: number, complete: number, partial: number, conflict: number) => ({
  checked, complete, partial, conflict, noVendorRecord: 0, lagging: 0, laggards: [], share: checked ? complete / checked : 0,
  conflicts: Array.from({ length: conflict }, (_, i) => ({ externalId: `c${i}`, name: `Conflicted ${i}`, loaded: "5-0-0", vendor: "4-0-0" })),
  partials: Array.from({ length: partial }, (_, i) => ({ externalId: `p${i}`, name: `Partial ${i}`, loaded: "1-0-0", vendor: "20-0-0" })),
});
const open = { minComplete: 0.9, allowPartial: false, allowConflicts: false };

test("the gate: a conflict always needs a deliberate override; too few complete records refuse a load; the bar and the overrides are explicit", () => {
  assert.deepEqual(recordGate(bad(100, 100, 0, 0), open), { ok: true, reasons: [] });
  assert.equal(recordGate(bad(100, 90, 10, 0), open).ok, true, "exactly at the bar passes");
  const low = recordGate(bad(100, 89, 11, 0), open);
  assert.equal(low.ok, false); assert.match(low.reasons[0], /only 89\.0% of fighters \(89 of 100\).*90% is required.*fewer fights than the vendor's career total.*Partial 0: loaded 1-0-0, vendor 20-0-0/);
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

// round 74: why a record is a conflict
const ev = (id: string, date: string) => ({ externalId: id, date }) as unknown as FeedData["events"][number];
const conflictFeed = (): FeedData => ({ ...miniFeed(), boxers: ["A", "B", "C", "D", "E", "F"].map(boxer),
  events: [ev("E1", "2020-01-01"), ev("E2", "2020-01-20"), ev("E3", "2020-06-01"), ev("E4", "2026-09-30"), ev("E5", "2026-09-30")],
  bouts: [
    bout("d1", "A", "B", { eventExternalId: "E1", winnerExternalId: null, method: "DRAW" }),   // A and B draw: the vendor says A has no draws
    bout("r1", "C", "D", { eventExternalId: "E1" }), bout("r2", "C", "D", { eventExternalId: "E2" }), // C beats D twice within 30 days
    bout("s1", "E", "D", { eventExternalId: "E4" }), bout("s2", "E", "F", { eventExternalId: "E5" }),   // E fights twice on one day
  ] });
const vendorOf = new Map([["A", rec(18, 0, 0)], ["B", rec(0, 0, 1)], ["C", rec(1, 0, 0)], ["D", rec(5, 1, 0)], ["E", rec(1, 0, 0)], ["F", rec(0, 1, 0)]]);

test("a conflict is explained from the fights: a draw the vendor lacks, a fight listed twice, two fights on one day, a total that trails the last days", () => {
  const r = explainConflicts(conflictFeed(), vendorOf, "2026-10-04");
  const by = (id: string) => r.fighters.find((f) => f.externalId === id)!;
  assert.deepEqual(by("A").causes, ["draw"], "0-0-1 against 18-0-0");
  assert.ok(!r.fighters.some((f) => f.externalId === "B"), "B's draw is the vendor's own");
  assert.ok(by("C").causes.includes("repeat")); assert.ok(!by("C").causes.includes("wins"), "a repeat is the reason, not a wrong winner");
  assert.ok(by("D").causes.includes("repeat"), "and so is the other side of the same repeated fight");
  assert.deepEqual(by("E").causes.sort(), ["recent", "same-day"].sort(), "two wins on 2026-09-30 against a total of one: the last days explain it, and so does the same date");
  assert.equal(r.tally.draw, 1); assert.equal(r.tally.unexplained, 0);
  const wrong = explainConflicts({ ...conflictFeed(), bouts: [bout("w1", "C", "D", { eventExternalId: "E1" }), bout("w2", "C", "F", { eventExternalId: "E3" })] }, new Map([["C", rec(1, 0, 0)], ["D", rec(0, 1, 0)], ["F", rec(0, 1, 0)]]), "2026-10-04");
  assert.deepEqual(wrong.fighters.map((f) => [f.name, f.causes]), [["Fighter C", ["wins"]]], "an extra win with nothing to blame is named as such");
});

test("the report prints the tally, and the fights behind the first N conflicts only when asked", () => {
  const r = explainConflicts(conflictFeed(), vendorOf, "2026-10-04");
  const tally = describeConflictReport(r).join("\n");
  assert.match(tally, /why the \d+ conflict/); assert.match(tally, /more draws loaded than the vendor counts/); assert.doesNotMatch(tally, /d1\)/);
  assert.match(describeConflictReport(r, 1).join("\n"), /Fighter A: loaded 0-0-1, vendor 18-0-0: draw\n\s+2020-01-01  D  DRAW\s+10 rds\s+vs Fighter B  \(d1\)/);
  assert.deepEqual(describeConflictReport(explainConflicts({ ...miniFeed(), boxers: [boxer("A")], bouts: [] }, new Map(), "2026-10-04")), [], "nothing to say when there is no conflict");
});

test("a surplus that goes away without the 3-round fights is named as one: probably an exhibition or amateur bout the vendor's total leaves out", () => {
  const feed: FeedData = { ...miniFeed(), boxers: ["A", "B", "C"].map(boxer), events: [ev("E1", "2014-01-01"), ev("E2", "2016-08-16")],
    bouts: [bout("pro", "A", "B", { eventExternalId: "E1" }), bout("ex", "C", "A", { eventExternalId: "E2", rounds: 3 })] };   // A beats B in 10; C beats A in 3: the vendor's A has one win and no loss
  const v = new Map([["A", rec(1, 0, 0)], ["B", rec(0, 1, 0)], ["C", rec(0, 0, 0)]]);
  const r = explainConflicts(feed, v, "2026-10-04", 14);
  const by = Object.fromEntries(r.fighters.map((f) => [f.name, f.causes]));
  assert.deepEqual(by["Fighter A"], ["short"], "A: a loaded loss the vendor lacks, in a 3-round fight");
  assert.deepEqual(by["Fighter C"], ["short"], "and the other side's win");
  assert.equal(r.tally.short, 2); assert.equal(r.tally.losses, 0, "not blamed on a wrong winner");
  assert.match(describeConflictReport(r, 1).join("\n"), /3 rds/);
});

test("a conflict that one reversed winner would remove is named as such: 1-0-0 loaded against a vendor 0-1-0", () => {
  const feed: FeedData = { ...miniFeed(), boxers: ["A", "B"].map(boxer), events: [ev("E1", "2020-01-01")], bouts: [bout("1", "A", "B", { eventExternalId: "E1" })] };   // A beats B
  const v = new Map([["A", rec(0, 1, 0)], ["B", rec(1, 0, 0)]]);                                                                                                   // the vendor has it the other way round
  const r = explainConflicts(feed, v, "2026-10-04", 14);
  assert.deepEqual(r.fighters.map((f) => [f.name, f.causes]), [["Fighter A", ["wins", "flipped"]], ["Fighter B", ["losses", "flipped"]]]);
  assert.equal(r.tally.flipped, 2);
  // a fighter with several surplus wins is not one flipped winner away from his record
  const many: FeedData = { ...miniFeed(), boxers: ["A", "B", "C", "D"].map(boxer), events: [ev("E1", "2020-01-01")], bouts: [bout("1", "A", "B", { eventExternalId: "E1" }), bout("2", "A", "C", { eventExternalId: "E1" }), bout("3", "A", "D", { eventExternalId: "E1" })] };
  const m = explainConflicts(many, new Map([["A", rec(0, 0, 0)], ["B", rec(0, 1, 0)], ["C", rec(0, 1, 0)], ["D", rec(0, 1, 0)]]), "2026-10-04", 14);
  assert.deepEqual(m.fighters.find((f) => f.name === "Fighter A")!.causes.includes("flipped"), false);
});

// round 82: what a one-fight reversal would do to the OTHER fighter
const oneFight = (): FeedData => ({ ...miniFeed(), boxers: ["A", "B"].map(boxer), events: [ev("E1", "2020-01-01")], bouts: [bout("1", "A", "B", { eventExternalId: "E1" })] }); // A beats B
const evidenceOf = (v: Map<string, ReturnType<typeof rec>>) => explainConflicts(oneFight(), v, "2026-10-04", 14);

test("flip evidence: a reversal that clears both fighters is mutual (the list's flag looks reversed)", () => {
  const r = evidenceOf(new Map([["A", rec(0, 1, 0)], ["B", rec(1, 0, 0)]]));   // the vendor has it the other way round for both
  assert.deepEqual(r.flipEvidence, { mutual: 2, open: 0, contradicted: 0 });
  assert.deepEqual(r.fighters.map((f) => f.flip), ["mutual", "mutual"]);
});

test("flip evidence: a reversal that would break an opponent whose record adds up exactly is contradicted (that winner looks right)", () => {
  const r = evidenceOf(new Map([["A", rec(0, 1, 0)], ["B", rec(0, 1, 0)]]));   // B's 0-1-0 is exact; only A's total is odd
  assert.equal(r.total, 1); assert.deepEqual(r.flipEvidence, { mutual: 0, open: 0, contradicted: 1 });
  // an opponent with a partial record that the reversal would push into a conflict is the same
  const p = evidenceOf(new Map([["A", rec(0, 1, 0)], ["B", rec(0, 3, 0)]]));   // B holds 0-1-0 of 0-3-0: partial; with a win he would exceed 0 wins
  assert.deepEqual(p.flipEvidence, { mutual: 0, open: 0, contradicted: 1 });
});

test("flip evidence: an opponent with no vendor record, or a partial one the reversal leaves partial, says nothing either way", () => {
  assert.deepEqual(evidenceOf(new Map([["A", rec(0, 1, 0)]])).flipEvidence, { mutual: 0, open: 1, contradicted: 0 });
  assert.deepEqual(evidenceOf(new Map([["A", rec(0, 1, 0)], ["B", rec(5, 4, 0)]])).flipEvidence, { mutual: 0, open: 1, contradicted: 0 });
  const text = describeConflictReport(evidenceOf(new Map([["A", rec(0, 1, 0)], ["B", rec(1, 0, 0)]]))).join("\n");
  assert.match(text, /of those: 2 where the same reversal would also clear the OTHER fighter's conflict/); assert.match(text, /0 where every such reversal would break an opponent/);
});
