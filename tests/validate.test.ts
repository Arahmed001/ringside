import test from "node:test";
import assert from "node:assert/strict";
import { groupIssues, sanitizeFeed, type Issue } from "../lib/validate";
import type { FeedData } from "../lib/feed";
import { makeBoxer, miniFeed } from "./helpers";

const TODAY = "2026-10-03";
const run = (mutate: (f: FeedData) => void) => { const f = miniFeed(); mutate(f); return sanitizeFeed(f, { today: TODAY }); };
const codes = (issues: Issue[], severity?: string) => issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);

test("a clean feed has no errors or warnings", () => {
  const r = sanitizeFeed(miniFeed(), { today: TODAY });
  assert.deepEqual(codes(r.issues, "error"), []);
  assert.deepEqual(codes(r.issues, "warning"), []);
  assert.equal(r.feed.bouts.length, 1);
  assert.deepEqual(r.dropped, {});
});

test("duplicate ids keep the first row and report the rest", () => {
  const r = run((f) => f.boxers.push(makeBoxer("A", "Welterweight")));
  assert.ok(codes(r.issues, "error").includes("dup_id"));
  assert.equal(r.feed.boxers.length, 2);
  assert.equal(r.feed.boxers.find((b) => b.externalId === "A")!.weightClass, "Lightweight");
});

test("an unknown division drops the fighter and, by reference, their bouts", () => {
  const r = run((f) => { f.boxers[0].weightClass = "Catchweight"; });
  assert.ok(codes(r.issues, "error").includes("unknown_division"));
  assert.equal(r.feed.boxers.length, 1);
  assert.equal(r.feed.bouts.length, 0);
  assert.equal(r.feed.scorecards.length, 0, "details of a dropped bout are dropped too");
  assert.equal(r.feed.weighIns.length, 0);
});

test("vendor spellings of a division are accepted", () => {
  const r = run((f) => { f.boxers[0].weightClass = "Light Welterweight"; f.boxers[1].weightClass = "Jr. Welterweight"; f.bouts[0].weightClass = "Super Lightweight"; });
  assert.deepEqual(codes(r.issues, "error"), []);
});

test("result consistency rules", () => {
  const cases: [string, (f: FeedData) => void, string][] = [
    ["winner not in the bout", (f) => { f.bouts[0].winnerExternalId = "Z"; }, "winner_not_in_bout"],
    ["decision without a winner", (f) => { f.bouts[0].winnerExternalId = null; }, "result_inconsistent"],
    ["draw with a winner", (f) => { f.bouts[0].method = "DRAW"; }, "result_inconsistent"],
    ["no-contest with a winner", (f) => { f.bouts[0].method = "NC"; }, "result_inconsistent"],
    ["winner with no method", (f) => { f.bouts[0].method = null; }, "result_inconsistent"],
    ["unknown method", (f) => { (f.bouts[0] as { method: string }).method = "WALKOVER"; }, "unknown_method"],
    ["ended after the scheduled distance", (f) => { f.bouts[0].endRound = 13; }, "bad_round"],
    ["zero rounds", (f) => { f.bouts[0].rounds = 0; }, "bad_round"],
    ["fighter against himself", (f) => { f.bouts[0].blueExternalId = "A"; }, "same_fighter"],
    ["unknown fighter", (f) => { f.bouts[0].blueExternalId = "Q"; }, "bad_reference"],
    ["unknown event", (f) => { f.bouts[0].eventExternalId = "E9"; }, "bad_reference"],
  ];
  for (const [name, mutate, code] of cases) {
    const r = run(mutate);
    assert.ok(codes(r.issues, "error").includes(code), `${name}: expected ${code}, got ${codes(r.issues).join(",")}`);
    assert.equal(r.feed.bouts.length, 0, `${name}: the bout must be dropped`);
  }
});

test("valid unusual endings pass", () => {
  for (const [method, winner, endRound] of [["RTD", "A", 6], ["DQ", "A", 3], ["NC", null, 2], ["TDRAW", null, 5], ["TD", "A", 5], ["DRAW", null, 12]] as const) {
    const r = run((f) => { f.bouts[0].method = method; f.bouts[0].winnerExternalId = winner; f.bouts[0].endRound = endRound; f.scorecards = []; });
    assert.deepEqual(codes(r.issues, "error"), [], method);
    assert.equal(r.feed.bouts.length, 1, method);
  }
});

test("an invalid event date drops the event and its bouts", () => {
  const r = run((f) => { f.events[0].date = "2025-02-30"; });
  assert.ok(codes(r.issues, "error").includes("bad_date"));
  assert.equal(r.feed.events.length, 0);
  assert.equal(r.feed.bouts.length, 0);
});

test("suspicious-but-usable rows are kept and warned about", () => {
  const warn = (mutate: (f: FeedData) => void, code: string) => {
    const r = run(mutate);
    assert.ok(codes(r.issues, "warning").includes(code), `expected warning ${code}, got ${codes(r.issues).join(",")}`);
    assert.equal(r.feed.bouts.length, 1, `${code}: row should be kept`);
  };
  warn((f) => { f.scorecards[0] = { ...f.scorecards[0], red: 112, blue: 116 }; }, "scorecard_result_mismatch"); // a UD with a card for the loser
  warn((f) => { f.scorecards.pop(); }, "scorecard_incomplete");
  warn((f) => { f.scorecards[1] = { ...f.scorecards[1], seat: 1 }; }, "scorecard_duplicate_seat");
  warn((f) => { f.scorecards[0] = { ...f.scorecards[0], red: 140 }; }, "scorecard_range");
  warn((f) => { f.weighIns[0].madeWeight = true; f.weighIns[0].officialLb = 137; }, "made_weight_inconsistent");
  warn((f) => { f.weighIns[0].madeWeight = false; f.weighIns[0].officialLb = 134; }, "made_weight_inconsistent");
  warn((f) => { f.weighIns[0].fightNightLb = 120; }, "fight_night_below_official");
  warn((f) => { f.weighIns[0].officialLb = 20; }, "weight_implausible");
  warn((f) => { f.weighIns[0].limitLb = 160; }, "limit_mismatch");
  warn((f) => { f.punches[0].landed = 600; }, "punch_inconsistent");
  warn((f) => { f.events[0].date = "2027-01-01"; }, "result_in_future");
  warn((f) => { f.boxers[0].heightCm = 300; }, "implausible_height");
  warn((f) => { f.bouts[0].oddsRed = 0.9; }, "odds_invalid");
});

test("a catchweight contract explains a non-standard limit", () => {
  const r = run((f) => { f.bouts[0].contractLb = 160; f.weighIns[0].limitLb = 160; f.weighIns[1].limitLb = 160; });
  assert.ok(!codes(r.issues).includes("limit_mismatch"));
});

test("technical decisions are scored over the rounds fought, not the scheduled distance", () => {
  const r = run((f) => {
    f.bouts[0].method = "TD"; f.bouts[0].endRound = 4;
    f.scorecards = [["J1", 40, 36], ["J2", 39, 37], ["J3", 40, 36]].map(([j, a, b], i) => ({ boutExternalId: "E1-1", judgeExternalId: j as string, seat: i + 1, red: a as number, blue: b as number }));
  });
  assert.ok(!codes(r.issues).includes("scorecard_range"), codes(r.issues).join(","));
  assert.ok(!codes(r.issues).includes("scorecard_result_mismatch"));
});

test("a fighter on two cards the same night is flagged; a cancelled one does not count", () => {
  const twice = (f: FeedData, status?: "cancelled") => {
    f.boxers.push(makeBoxer("C"), makeBoxer("D"));
    f.bouts.push({ externalId: "E1-2", eventExternalId: "E1", redExternalId: "A", blueExternalId: "C", weightClass: "Lightweight", rounds: 8, winnerExternalId: null, method: null, endRound: null, title: null, position: 1, status });
  };
  assert.ok(codes(run((f) => twice(f)).issues, "warning").includes("fighter_double_booked"));
  assert.ok(!codes(run((f) => twice(f, "cancelled")).issues).includes("fighter_double_booked"));
});

test("team history rules", () => {
  const err = (stint: Partial<FeedData["stints"][number]>, code: string) => {
    const r = run((f) => { f.stints.push({ boxerExternalId: "A", role: "manager", personExternalId: "T2", start: "2021-01-01", end: null, ...stint }); });
    assert.ok(codes(r.issues, "error").includes(code), `${code}: got ${codes(r.issues).join(",")}`);
    assert.equal(r.feed.stints.length, 1, `${code}: bad stint dropped, good one kept`);
  };
  err({ end: "2020-01-01" }, "stint_bad_dates");
  err({ personExternalId: undefined }, "stint_no_entity");
  err({ role: "gym", personExternalId: undefined, orgExternalId: undefined }, "stint_no_entity");
  err({ personExternalId: "NOBODY" }, "bad_reference");
  err({ boxerExternalId: "NOBODY" }, "bad_reference");
  err({ start: "last spring" }, "bad_date");
  const overlap = run((f) => { f.stints.push({ boxerExternalId: "A", role: "head_trainer", personExternalId: "T2", start: "2022-01-01", end: null }); });
  assert.ok(codes(overlap.issues, "warning").includes("head_trainer_overlap"), "two open head-trainer stints overlap");
  const clean = run((f) => { f.stints[0].end = "2021-12-31"; f.stints.push({ boxerExternalId: "A", role: "head_trainer", personExternalId: "T2", start: "2022-01-01", end: null }); });
  assert.ok(!codes(clean.issues).includes("head_trainer_overlap"), "back-to-back tenures are fine");
});

test("detail rows pointing nowhere are dropped", () => {
  const r = run((f) => {
    f.weighIns.push({ boutExternalId: "NOPE", boxerExternalId: "A", officialLb: 135 });
    f.weighIns.push({ boutExternalId: "E1-1", boxerExternalId: "ZZ", officialLb: 135 });
    f.officials.push({ boutExternalId: "E1-1", role: "referee", personExternalId: "NOBODY" });
    f.corners.push({ boutExternalId: "E1-1", boxerExternalId: "A", role: "head_trainer", personExternalId: "NOBODY" });
  });
  assert.equal(r.feed.weighIns.length, 2);
  assert.equal(r.feed.officials.length, 4);
  assert.equal(r.feed.corners.length, 1);
  assert.equal(r.dropped.weigh_in, 2);
});

test("groupIssues puts errors first and counts per code", () => {
  const r = run((f) => { f.boxers.push(makeBoxer("A")); f.boxers.push(makeBoxer("A")); f.punches[0].landed = 999; });
  const g = groupIssues(r.issues);
  assert.equal(g[0].severity, "error");
  assert.equal(g.find((x) => x.code === "dup_id")!.count, 2);
});
